import { NextResponse } from 'next/server';
import { parseCraftSpeech, transcribeAudio } from '@/lib/voiceParse';

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

    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      const audio = form.get('file');
      const text = form.get('text');

      if (audio instanceof Blob && audio.size > 0) {
        transcript = await transcribeAudio(audio);
        transcribed = Boolean(transcript);

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
        transcript = text;
      }
    } else {
      const body = await req.json().catch(() => ({}));
      if (typeof body?.regionalTranscript === 'string') transcript = body.regionalTranscript;
      else if (typeof body?.text === 'string') transcript = body.text;
    }

    if (!transcript || !transcript.trim()) {
      return NextResponse.json(
        { error: 'An audio recording or a text description is required.' },
        { status: 400 }
      );
    }

    const parsed = await parseCraftSpeech(transcript);
    return NextResponse.json({ success: true, transcribed, data: parsed });
  } catch (error) {
    console.error('Voice parse error:', error);
    return NextResponse.json({ error: 'Failed to parse the description' }, { status: 500 });
  }
}
