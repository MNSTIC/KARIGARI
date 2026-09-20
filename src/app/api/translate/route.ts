import { NextResponse } from 'next/server';
import { groqChatJSON } from '@/lib/groq';

export async function POST(req: Request) {
  try {
    const { strings, targetLanguage } = await req.json();
    if (!Array.isArray(strings) || strings.length === 0 || !targetLanguage) {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
    }

    if (targetLanguage === 'en') {
      return NextResponse.json({ translated: strings });
    }

    const languageName = { hi: 'Hindi', or: 'Odia', te: 'Telugu' }[targetLanguage as string] || 'Hindi';

    const response = await groqChatJSON<{ translations: string[] }>(
      `Translate the following array of strings into ${languageName}. 
      Return exactly ${strings.length} translations in the same order. 
      Keep exact formatting, punctuation, spaces, and context. 
      Do NOT translate proper nouns (names of cities, specific people, or unique brands) unless they have an established translation.
      Strings to translate: ${JSON.stringify(strings)}`,
      {
        system: `You are a translation API. Output JSON with a "translations" array containing exactly ${strings.length} translated strings.`,
        temperature: 0.0,
      }
    );

    if (!response || !Array.isArray(response.translations)) {
      throw new Error("Invalid format returned from Groq");
    }

    // Return as many as we got. The client will match by index up to the smaller length
    return NextResponse.json({ translated: response.translations });
  } catch (error) {
    console.error('Translation API error:', error);
    return NextResponse.json({ error: 'Translation failed' }, { status: 500 });
  }
}
