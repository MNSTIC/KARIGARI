import twilio from 'twilio';
import { prisma } from '@/lib/prisma';
import { logCraftItemEvent } from '@/lib/auditLogger';
import { parseCraftSpeech } from '@/lib/voiceParse';
import {
  readTwilioForm,
  rejectedResponse,
  SAY_OPTIONS,
  twimlResponse,
  verifyTwilioSignature,
} from '@/lib/twilioIvr';

export const dynamic = 'force-dynamic';

/**
 * Step 3 of 3: turn the spoken description into an incomplete draft CraftItem
 * under the matched artisan's account.
 *
 * The draft is deliberately unfinished — no image, no price — so it cannot slip
 * into the admin queue on the strength of a phone call alone. The artisan
 * completes it in the dashboard, which is where `PENDING_VERIFICATION` starts.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const artisanId = url.searchParams.get('artisanId') || '';
  const name = url.searchParams.get('name') || '';

  const params = await readTwilioForm(req);
  const check = verifyTwilioSignature(req, params, '/api/ivr/collect-item', {
    artisanId,
    name,
  });
  if (!check.ok) return rejectedResponse(check.reason);

  const vr = new twilio.twiml.VoiceResponse();
  const transcript = (params.SpeechResult || '').trim();

  if (!artisanId || !transcript) {
    vr.say(SAY_OPTIONS, 'Sorry, we did not catch that description. Please call again. Goodbye.');
    vr.hangup();
    return twimlResponse(vr.toString());
  }

  try {
    // The artisanId rode in on the query string, so re-check it against the DB
    // rather than trusting it: the signature proves Twilio sent the request,
    // not that the id inside it is a real artisan.
    const artisan = await prisma.user.findFirst({
      where: { id: artisanId, role: 'ARTISAN' },
      select: { id: true, name: true },
    });

    if (!artisan) {
      console.warn(`[ivr] collect-item for unknown artisan ${artisanId}`);
      vr.say(SAY_OPTIONS, 'We could not find your account. Please visit your local facilitator. Goodbye.');
      vr.hangup();
      return twimlResponse(vr.toString());
    }

    // Same parser the in-app capture flow uses. It degrades to placeholders
    // when Gemini is unreachable but always keeps the real spoken words.
    const parsed = await parseCraftSpeech(transcript);

    const draft = await prisma.craftItem.create({
      data: {
        artisanId: artisan.id,
        craftType: parsed.craftType,
        descriptionOriginal: transcript,
        descriptionEnglish: parsed.englishDescription,
        laborDays: Math.round(parsed.laborDays),
        rawMaterialCost: parsed.rawMaterialCost,
        voiceLanguage: parsed.sourceLanguage,
        catalogMethod: 'IVR',
        ivrCallSid: params.CallSid ?? null,
        status: 'IVR_DRAFT',
        images: [],
        askingPrice: null,
        tags: [],
      },
      select: { id: true, craftType: true },
    });

    await logCraftItemEvent({
      prisma,
      craftItemId: draft.id,
      actorId: artisan.id,
      actorRole: 'ARTISAN',
      action: 'IVR_DRAFT_CREATED',
      newState: {
        status: 'IVR_DRAFT',
        craftType: draft.craftType,
        catalogMethod: 'IVR',
        ivrCallSid: params.CallSid ?? null,
      },
      comments:
        `Draft created from a toll-free IVR call${params.From ? ` from ${params.From}` : ''}. ` +
        `Transcript: "${transcript.slice(0, 300)}". ` +
        `${parsed.aiParsed ? 'Fields structured by AI.' : 'AI unavailable — labour and material figures are placeholders for the artisan to correct.'} ` +
        'No photo or price yet; the artisan completes it in the dashboard before verification.',
    });

    console.log(`[ivr] draft ${draft.id} created for artisan ${artisan.id} (call ${params.CallSid ?? '?'})`);

    vr.say(
      SAY_OPTIONS,
      'Thank you. Your craft has been saved as a draft under your account. Please log in to KARIGARI, add a photo and a price, and submit it for verification. Goodbye.'
    );
    vr.hangup();
    return twimlResponse(vr.toString());
  } catch (error) {
    console.error('[ivr] failed to create draft:', error);
    vr.say(
      SAY_OPTIONS,
      `Sorry ${name || ''}, we could not save your craft right now. Please try again later. Goodbye.`
    );
    vr.hangup();
    return twimlResponse(vr.toString());
  }
}
