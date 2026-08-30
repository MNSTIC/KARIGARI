/**
 * Shared plumbing for the toll-free AI IVR webhooks.
 *
 * Twilio speaks a different dialect to the rest of this app: it POSTs
 * `application/x-www-form-urlencoded`, expects `text/xml` back, and is
 * stateless between requests — anything the next step needs has to travel in
 * the `action` URL. These helpers keep that dialect in one place so the three
 * route handlers stay readable.
 */

import twilio from 'twilio';

/** Twilio form fields the IVR actually reads. */
export interface TwilioVoiceParams {
  CallSid?: string;
  From?: string;
  To?: string;
  SpeechResult?: string;
  Confidence?: string;
  [key: string]: string | undefined;
}

/**
 * The public origin Twilio reaches this app on.
 *
 * The signature is computed over the URL Twilio actually requested, so this has
 * to be the tunnel/production origin, never `localhost`. Trailing slashes are
 * trimmed because they would change the signed string.
 */
export function publicBaseUrl(): string {
  return (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
}

/** Absolute URL for an IVR endpoint, used both for signing and for `action`. */
export function ivrUrl(path: string, query: Record<string, string> = {}): string {
  const base = publicBaseUrl();
  const qs = new URLSearchParams(query).toString();
  return `${base}${path}${qs ? `?${qs}` : ''}`;
}

/** Reads Twilio's urlencoded body into a plain object. */
export async function readTwilioForm(req: Request): Promise<TwilioVoiceParams> {
  const form = await req.formData();
  const params: TwilioVoiceParams = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') params[key] = value;
  }
  return params;
}

export type SignatureCheck =
  | { ok: true; bypassed: boolean }
  | { ok: false; reason: string };

/**
 * Validate `X-Twilio-Signature`.
 *
 * Without this anyone who learns the URL can POST a forged call and mint draft
 * items under another artisan's account, so the default is to reject. The only
 * way past it is an explicit local opt-in: `IVR_SKIP_SIGNATURE=true` **and** a
 * non-production build. Both conditions are required, and neither is the
 * default.
 */
export function verifyTwilioSignature(
  req: Request,
  params: TwilioVoiceParams,
  path: string,
  query: Record<string, string> = {}
): SignatureCheck {
  const skip = process.env.IVR_SKIP_SIGNATURE === 'true';
  const isProd = process.env.NODE_ENV === 'production';

  if (skip && !isProd) {
    console.warn(`[ivr] signature check bypassed for ${path} (IVR_SKIP_SIGNATURE=true, dev only)`);
    return { ok: true, bypassed: true };
  }

  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) return { ok: false, reason: 'TWILIO_AUTH_TOKEN is not configured' };
  if (!publicBaseUrl()) return { ok: false, reason: 'PUBLIC_BASE_URL is not configured' };

  const signature = req.headers.get('x-twilio-signature');
  if (!signature) return { ok: false, reason: 'Missing X-Twilio-Signature header' };

  // Twilio signs the exact URL it requested, query string included.
  const url = ivrUrl(path, query);
  const valid = twilio.validateRequest(authToken, signature, url, params as Record<string, string>);

  return valid ? { ok: true, bypassed: false } : { ok: false, reason: 'Signature mismatch' };
}

/** TwiML responses must be served as XML or Twilio drops the call. */
export function twimlResponse(xml: string): Response {
  return new Response(xml, {
    status: 200,
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
  });
}

/**
 * A refused webhook still has to sound like something to the caller, so the
 * 403 carries a spoken line rather than a bare error body.
 */
export function rejectedResponse(reason: string): Response {
  console.warn(`[ivr] rejected webhook: ${reason}`);
  const vr = new twilio.twiml.VoiceResponse();
  vr.say(
    { voice: 'Polly.Aditi', language: 'en-IN' },
    'This request could not be verified. Goodbye.'
  );
  vr.hangup();
  return new Response(vr.toString(), {
    status: 403,
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
  });
}

/** The voice used for every prompt on the line. */
export const SAY_OPTIONS = { voice: 'Polly.Aditi' as const, language: 'en-IN' as const };
