import twilio from 'twilio';
import {
  ivrUrl,
  readTwilioForm,
  rejectedResponse,
  SAY_OPTIONS,
  twimlResponse,
  verifyTwilioSignature,
} from '@/lib/twilioIvr';

export const dynamic = 'force-dynamic';

/**
 * Entry point for the toll-free artisan helpline. This is the URL configured on
 * the Twilio number under Voice → "A call comes in".
 *
 * Step 1 of 3: greet, then collect the caller's name.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const attempt = Number(url.searchParams.get('attempt') || '1');
  // Must mirror exactly what Twilio requested: the signature covers the query
  // string, and the number's configured webhook has none on the first call.
  const query: Record<string, string> = attempt > 1 ? { attempt: String(attempt) } : {};

  const params = await readTwilioForm(req);
  const check = verifyTwilioSignature(req, params, '/api/ivr/voice', query);
  if (!check.ok) return rejectedResponse(check.reason);

  const vr = new twilio.twiml.VoiceResponse();

  const gather = vr.gather({
    input: ['speech'],
    language: 'en-IN',
    speechTimeout: 'auto',
    action: ivrUrl('/api/ivr/collect-name', { attempt: String(attempt) }),
    method: 'POST',
  });

  gather.say(
    SAY_OPTIONS,
    attempt > 1
      ? 'Let us try once more. After the beep, please say your name.'
      : 'Welcome to the KARIGARI artisan helpline. After the beep, please say your name.'
  );

  // Reached only when <Gather> hears nothing at all. Two silent attempts, then
  // the call ends rather than looping a caller who cannot be heard.
  if (attempt >= 2) {
    vr.say(SAY_OPTIONS, 'Sorry, we did not hear anything. Please call again later. Goodbye.');
    vr.hangup();
  } else {
    vr.redirect(
      { method: 'POST' },
      ivrUrl('/api/ivr/voice', { attempt: String(attempt + 1) })
    );
  }

  return twimlResponse(vr.toString());
}
