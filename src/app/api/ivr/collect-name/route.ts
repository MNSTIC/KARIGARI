import twilio from 'twilio';
import { prisma } from '@/lib/prisma';
import {
  ivrUrl,
  readTwilioForm,
  rejectedResponse,
  SAY_OPTIONS,
  twimlResponse,
  verifyTwilioSignature,
} from '@/lib/twilioIvr';

export const dynamic = 'force-dynamic';

/** Speech-to-text arrives with stray punctuation and casing; strip both. */
function normalizeSpokenName(raw: string): string {
  return raw.trim().replace(/[.,!?]+$/g, '').trim();
}

/**
 * Phone numbers reach us as E.164 (+919812345678) while profiles often store
 * them bare or spaced. Comparing the last 10 digits sidesteps every variant of
 * country code and formatting.
 */
function lastTenDigits(value: string | null | undefined): string | null {
  const digits = (value ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : null;
}

/** Name is the primary key per the spec; the caller's number is the safety net. */
async function findArtisan(spokenName: string, fromNumber?: string) {
  const name = normalizeSpokenName(spokenName);

  if (name) {
    const exact = await prisma.user.findFirst({
      where: { role: 'ARTISAN', name: { equals: name, mode: 'insensitive' } },
      select: { id: true, name: true },
    });
    if (exact) return { artisan: exact, matchedBy: 'name-exact' };

    const partial = await prisma.user.findFirst({
      where: { role: 'ARTISAN', name: { contains: name, mode: 'insensitive' } },
      select: { id: true, name: true },
    });
    if (partial) return { artisan: partial, matchedBy: 'name-contains' };
  }

  // Fallback: the speech was unclear but the line itself identifies them.
  const callerDigits = lastTenDigits(fromNumber);
  if (callerDigits) {
    const profiles = await prisma.artisanProfile.findMany({
      where: { mobileNumber: { not: null } },
      select: { mobileNumber: true, user: { select: { id: true, name: true, role: true } } },
    });
    const hit = profiles.find(
      (p) => p.user.role === 'ARTISAN' && lastTenDigits(p.mobileNumber) === callerDigits
    );
    if (hit) return { artisan: { id: hit.user.id, name: hit.user.name }, matchedBy: 'phone' };
  }

  return { artisan: null, matchedBy: 'none' };
}

/**
 * Step 2 of 3: match the spoken name to a KARIGARI artisan account, then ask
 * them to describe the craft.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const attempt = Number(url.searchParams.get('attempt') || '1');

  const params = await readTwilioForm(req);
  const check = verifyTwilioSignature(req, params, '/api/ivr/collect-name', {
    attempt: String(attempt),
  });
  if (!check.ok) return rejectedResponse(check.reason);

  const vr = new twilio.twiml.VoiceResponse();
  const spoken = params.SpeechResult || '';

  let artisan: { id: string; name: string } | null = null;
  let matchedBy = 'none';
  try {
    const result = await findArtisan(spoken, params.From);
    artisan = result.artisan;
    matchedBy = result.matchedBy;
  } catch (error) {
    console.error('[ivr] artisan lookup failed:', error);
    vr.say(SAY_OPTIONS, 'We are having trouble reaching our records right now. Please call again later. Goodbye.');
    vr.hangup();
    return twimlResponse(vr.toString());
  }

  if (!artisan) {
    console.warn(`[ivr] no artisan matched for "${spoken}" (from ${params.From ?? 'unknown'})`);

    if (attempt >= 2) {
      vr.say(
        SAY_OPTIONS,
        'We could not find your account by that name. Please visit your local facilitator for help. Goodbye.'
      );
      vr.hangup();
    } else {
      vr.say(SAY_OPTIONS, 'We could not find your account by that name. Please try again.');
      vr.redirect({ method: 'POST' }, ivrUrl('/api/ivr/voice', { attempt: String(attempt + 1) }));
    }
    return twimlResponse(vr.toString());
  }

  console.log(`[ivr] matched artisan ${artisan.id} by ${matchedBy} (call ${params.CallSid ?? '?'})`);

  const gather = vr.gather({
    input: ['speech'],
    language: 'en-IN',
    speechTimeout: 'auto',
    action: ivrUrl('/api/ivr/collect-item', { artisanId: artisan.id, name: artisan.name }),
    method: 'POST',
  });

  gather.say(
    SAY_OPTIONS,
    `Thank you ${artisan.name}. Now, after the beep, describe the craft you have made — what it is, the material, and how many days it took.`
  );

  // Nothing said after the prompt: end politely rather than saving an empty draft.
  vr.say(SAY_OPTIONS, 'Sorry, we did not hear a description. Please call again. Goodbye.');
  vr.hangup();

  return twimlResponse(vr.toString());
}
