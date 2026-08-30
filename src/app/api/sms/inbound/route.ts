import twilio from 'twilio';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * Inbound SMS webhook: the artisan's side of a demand alert.
 *
 * An artisan with no smartphone answers a demand by texting a single digit.
 * This turns that digit into the same DB state the dashboard would have
 * produced, then texts back a confirmation, so the whole loop closes without
 * anyone opening the app.
 *
 * Twilio POSTs urlencoded and expects TwiML back, so every path here returns
 * valid XML — including the failures, otherwise the sender sees a carrier error
 * instead of an answer.
 */

/** Reply text is spoken back to a feature phone; keep it short and concrete. */
function twiml(message?: string): Response {
  const vr = new twilio.twiml.MessagingResponse();
  if (message) vr.message(message);
  return new Response(vr.toString(), {
    status: 200,
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
  });
}

function rejected(reason: string): Response {
  console.warn(`[sms-inbound] rejected: ${reason}`);
  return new Response('Forbidden', { status: 403 });
}

/**
 * Numbers arrive as E.164 but are stored however they were typed, so the last
 * ten digits are the only reliable comparison.
 */
function lastTenDigits(value: string | null | undefined): string | null {
  const digits = (value ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : null;
}

export async function POST(req: Request) {
  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') params[key] = value;
  }

  // ---- Signature check ---------------------------------------------------
  // Without it, anyone who learns this URL could accept demands on an
  // artisan's behalf just by knowing their phone number.
  const skip = process.env.SMS_SKIP_SIGNATURE === 'true';
  const isProd = process.env.NODE_ENV === 'production';

  if (!(skip && !isProd)) {
    const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
    const base = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
    const signature = req.headers.get('x-twilio-signature');

    if (!authToken) return rejected('TWILIO_AUTH_TOKEN is not configured');
    if (!base) return rejected('PUBLIC_BASE_URL is not configured');
    if (!signature) return rejected('missing X-Twilio-Signature');

    const valid = twilio.validateRequest(authToken, signature, `${base}/api/sms/inbound`, params);
    if (!valid) return rejected('signature mismatch');
  } else {
    console.warn('[sms-inbound] signature check bypassed (SMS_SKIP_SIGNATURE=true, dev only)');
  }

  const from = params.From || '';
  const bodyText = (params.Body || '').trim().toLowerCase();

  try {
    // ---- Who texted us --------------------------------------------------
    const callerDigits = lastTenDigits(from);
    if (!callerDigits) return twiml("This number isn't linked to a KARIGARI artisan account.");

    const profiles = await prisma.artisanProfile.findMany({
      where: { mobileNumber: { not: null } },
      select: { mobileNumber: true, user: { select: { id: true, name: true, role: true } } },
    });

    const match = profiles.find(
      (p) => p.user.role === 'ARTISAN' && lastTenDigits(p.mobileNumber) === callerDigits
    );

    if (!match) {
      console.warn(`[sms-inbound] no artisan for ${from}`);
      return twiml("This number isn't linked to a KARIGARI artisan account.");
    }

    const artisan = match.user;

    // ---- What they said --------------------------------------------------
    const isAccept = bodyText === '1' || bodyText === 'yes' || bodyText === 'y';
    const isDecline = bodyText === '2' || bodyText === 'no' || bodyText === 'n';

    if (!isAccept && !isDecline) {
      return twiml('Reply 1 to accept the latest demand, or 2 to skip.');
    }

    // The alert being answered is the newest one still open, which is the one
    // the artisan just received.
    const pending = await prisma.notification.findFirst({
      where: { userId: artisan.id, type: 'DEMAND_ALERT', accepted: false, read: false },
      orderBy: { createdAt: 'desc' },
    });

    if (!pending) {
      return twiml('You have no open demand to respond to right now.');
    }

    if (isDecline) {
      await prisma.notification.update({
        where: { id: pending.id },
        data: { read: true },
      });
      console.log(`[sms-inbound] ${artisan.id} declined notification ${pending.id}`);
      return twiml("No problem — we won't list this one.");
    }

    // ---- Accept ----------------------------------------------------------
    await prisma.notification.update({
      where: { id: pending.id },
      data: { accepted: true, acceptedAt: new Date(), read: true },
    });

    let craftType = 'your craft';
    if (pending.relatedDemandId) {
      // Only an OPEN demand advances: one already fulfilled must not be
      // dragged backwards by a late reply.
      const demand = await prisma.demand.findUnique({
        where: { id: pending.relatedDemandId },
        select: { craftType: true, status: true },
      });

      if (demand) {
        craftType = demand.craftType;
        if (demand.status === 'OPEN') {
          await prisma.demand.update({
            where: { id: pending.relatedDemandId },
            data: { status: 'MATCHED' },
          });
        }
      }
    }

    console.log(`[sms-inbound] ${artisan.id} accepted notification ${pending.id}`);
    return twiml(
      `Thank you ${artisan.name}! We've recorded your interest in ${craftType}. KARIGARI will connect you with the buyer.`
    );
  } catch (error) {
    // Never leave Twilio without TwiML: the artisan would see a carrier failure
    // rather than an answer, and would have no idea their reply was received.
    console.error('[sms-inbound] handler failed:', error);
    return twiml('Sorry, we could not process that just now. Please try again shortly.');
  }
}
