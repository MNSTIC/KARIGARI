import { NextResponse } from 'next/server';
import { parseCraftSpeech, transcribeAudio } from '@/lib/voiceParse';
import { isGroqConfigured } from '@/lib/groq';

/**
 * Turn what an artisan said into draft listing fields.
 *
 * Accepts three shapes, because two different clients call it:
 *   - multipart `file`  — recorded audio, transcribed by Groq Whisper
 *   - multipart `text`  — a typed or dictated description
 *   - JSON `{ regionalTranscript }` — the original contract, still honoured
 *
 * The parsing itself lives in `@/lib/voiceParse`, so the toll-free IVR
 * (`/api/ivr/collect-item`) structures a spoken description through exactly the
 * same code path and the two can never disagree.
 */
export async function POST(req: Request) {
  try {
    const contentType = req.headers.get('content-type') || '';
    let transcript: string | null = null;
    let transcribed = false;

    // The artisan's chosen UI language, so the parser can hand back a
    // description in it as well as the English ONDC copy.
    let targetLanguage: string | null = null;

    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      const audio = form.get('file');
      const text = form.get('text');
      const lang = form.get('language');
      if (typeof lang === 'string') targetLanguage = lang;
      // Everything the artisan said in earlier turns of this capture. Merged
      // with the new recording so a follow-up answer ("it took 12 days") is
      // understood together with the craft named a turn earlier, rather than
      // replacing it.
      const priorContext = typeof form.get('context') === 'string'
        ? (form.get('context') as string).trim()
        : '';

      if (audio instanceof Blob && audio.size > 0) {
        // Whisper is the only transcription path. Say so plainly rather than
        // returning a generic failure the artisan cannot act on.
        if (!isGroqConfigured()) {
          return NextResponse.json(
            { error: 'Voice AI not configured. Please type your description instead.' },
            { status: 503 }
          );
        }

        // A tap-and-release produces a few hundred bytes of silence. Whisper
        // bills for it and returns nothing useful, so reject it up front.
        if (audio.size < 4096) {
          return NextResponse.json(
            { error: 'That recording was too short. Hold the mic and describe your craft.' },
            { status: 400 }
          );
        }

        // The artisan's chosen language is a hint, not a guess, for Whisper.
        transcript = await transcribeAudio(audio, targetLanguage);
        transcribed = Boolean(transcript);

        if (transcript && priorContext) {
          transcript = `${priorContext}. ${transcript}`;
        }

        if (!transcript) {
          // Be explicit rather than inventing a craft out of nothing: the
          // client can then ask the artisan to type instead of silently
          // saving a listing they never described.
          return NextResponse.json(
            { error: 'Could not transcribe the recording. Please try again or type your description.' },
            { status: 502 }
          );
        }
      } else if (typeof text === 'string') {
        transcript = priorContext ? `${priorContext}. ${text}` : text;
      }
    } else {
      const body = await req.json().catch(() => ({}));
      if (typeof body?.regionalTranscript === 'string') transcript = body.regionalTranscript;
      else if (typeof body?.text === 'string') transcript = body.text;
      if (typeof body?.language === 'string') targetLanguage = body.language;
    }

    if (!transcript || !transcript.trim()) {
      return NextResponse.json(
        { error: 'An audio recording or a text description is required.' },
        { status: 400 }
      );
    }

    const parsed = await parseCraftSpeech(transcript, targetLanguage);
    return NextResponse.json({ success: true, transcribed, data: parsed });
  } catch (error) {
    console.error('Voice parse error:', error);
    return NextResponse.json({ error: 'Failed to parse the description' }, { status: 500 });
  }
}
