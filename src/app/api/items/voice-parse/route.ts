import { NextResponse } from 'next/server';
import { parseCraftSpeech } from '@/lib/voiceParse';

/**
 * In-app capture flow. The parsing itself lives in `@/lib/voiceParse` so the
 * toll-free IVR (`/api/ivr/collect-item`) structures a spoken description
 * through exactly the same code path.
 */
export async function POST(req: Request) {
  try {
    const { regionalTranscript } = await req.json();

    if (!regionalTranscript) {
      return NextResponse.json({ error: 'regionalTranscript is required' }, { status: 400 });
    }

    const parsed = await parseCraftSpeech(regionalTranscript);
    return NextResponse.json({ success: true, data: parsed });
  } catch (error) {
    console.error('Voice parse error:', error);
    return NextResponse.json({ error: 'Failed to parse the transcript' }, { status: 500 });
  }
}
