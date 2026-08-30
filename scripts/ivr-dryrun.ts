import 'dotenv/config';
import twilio from 'twilio';

/**
 * Drives the three IVR webhooks exactly as Twilio would: urlencoded bodies,
 * real `X-Twilio-Signature` headers, and the `action` URL of each step fed into
 * the next. Proves the pipeline end to end without a phone call, and proves the
 * signature check rejects a tampered request.
 *
 *   npx tsx scripts/ivr-dryrun.ts "Lakshmi Devi" "I made a silk saree..."
 */

const BASE = (process.env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const CALL_SID = 'CAdryrun00000000000000000000000001';
const FROM = '+15551230000';

if (!TOKEN) {
  console.error('TWILIO_AUTH_TOKEN is not set — cannot sign requests.');
  process.exit(1);
}

async function post(url: string, params: Record<string, string>, opts: { tamper?: boolean } = {}) {
  const signature = twilio.getExpectedTwilioSignature(TOKEN, url, params);
  const body = new URLSearchParams(params).toString();

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Twilio-Signature': opts.tamper ? 'Zm9yZ2Vkc2lnbmF0dXJlPT0=' : signature,
    },
    body,
  });

  return { status: res.status, xml: await res.text() };
}

/** Pulls the next step's URL out of the TwiML we just received. */
function actionUrl(xml: string): string | null {
  return xml.match(/action="([^"]+)"/)?.[1]?.replace(/&amp;/g, '&') ?? null;
}

function redirectUrl(xml: string): string | null {
  return xml.match(/<Redirect[^>]*>([^<]+)<\/Redirect>/)?.[1]?.replace(/&amp;/g, '&') ?? null;
}

function say(xml: string): string {
  return [...xml.matchAll(/<Say[^>]*>([^<]*)<\/Say>/g)].map((m) => m[1]).join(' | ');
}

async function main() {
  const spokenName = process.argv[2] || 'Lakshmi Devi';
  const spokenItem =
    process.argv[3] ||
    'I have woven a Pochampally Ikat silk saree using pure mulberry silk. It took me twelve days and the yarn cost around three thousand rupees.';

  console.log('--- 1. tampered signature must be refused -------------------');
  const forged = await post(`${BASE}/api/ivr/voice`, { CallSid: CALL_SID, From: FROM }, { tamper: true });
  console.log(`   HTTP ${forged.status} ${forged.status === 403 ? 'REJECTED (correct)' : 'ACCEPTED — BUG'}`);

  console.log('--- 2. POST /api/ivr/voice ----------------------------------');
  const step1 = await post(`${BASE}/api/ivr/voice`, { CallSid: CALL_SID, From: FROM, To: '+15550000000' });
  console.log(`   HTTP ${step1.status}`);
  console.log(`   says: ${say(step1.xml)}`);
  const nameUrl = actionUrl(step1.xml);
  console.log(`   next: ${nameUrl}`);
  if (step1.status !== 200 || !nameUrl) return console.error('   stopped: no gather action');

  console.log('--- 3. POST /api/ivr/collect-name ---------------------------');
  const step2 = await post(nameUrl, { CallSid: CALL_SID, From: FROM, SpeechResult: spokenName, Confidence: '0.94' });
  console.log(`   HTTP ${step2.status}`);
  console.log(`   says: ${say(step2.xml)}`);
  const itemUrl = actionUrl(step2.xml);
  if (!itemUrl) {
    console.log(`   no match; redirect -> ${redirectUrl(step2.xml)}`);
    return;
  }
  console.log(`   next: ${itemUrl}`);

  console.log('--- 4. POST /api/ivr/collect-item ---------------------------');
  const step3 = await post(itemUrl, { CallSid: CALL_SID, From: FROM, SpeechResult: spokenItem, Confidence: '0.91' });
  console.log(`   HTTP ${step3.status}`);
  console.log(`   says: ${say(step3.xml)}`);
  console.log(`   hangup: ${step3.xml.includes('<Hangup/>')}`);
}

main().catch((e) => {
  console.error('dry run failed:', e);
  process.exit(1);
});
