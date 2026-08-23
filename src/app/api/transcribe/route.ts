import { NextResponse } from 'next/server';
import { generateContentWithFallback } from '@/lib/gemini';

export async function POST(req: Request) {
  try {
    const { audio, language, artisanName, currentRoute } = await req.json();
    
    if (!audio) {
      return NextResponse.json({ success: false, error: 'No audio provided' }, { status: 400 });
    }

    const geminiKey = process.env.GEMINI_API_KEY;

    if (!geminiKey) {
      console.log("[Gemini API] GEMINI_API_KEY missing. Simulating transcription...");
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      let transcriptText = "I need help with government schemes. What are the benefits of PM Vishwakarma?";
      if (language === 'hi') transcriptText = "मुझे सरकारी योजनाओं में मदद चाहिए। पीएम विश्वकर्मा के क्या लाभ हैं?";
      if (language === 'or') transcriptText = "ମୋତେ ସରକାରୀ ଯୋଜନା ବିଷୟରେ ସାହାଯ୍ୟ ଦରକାର। ପିଏମ୍ ବିଶ୍ୱକର୍ମାର ଲାଭ କ'ଣ?";
      
      let responseText = "I will help you apply for this scheme using your verified Aadhaar profile.";
      return NextResponse.json({
        success: true,
        transcript: transcriptText,
        response: responseText
      });
    }

    // 1. Extract base64
    const base64Data = audio.replace(/^data:audio\/\w+;base64,/, "");

    // 2. Prepare the prompt for Gemini (Single Pass STT + NLP)
    const prompt = `You are the 'Karigari' app voice assistant.
Your user is a marginalized Indian artisan named ${artisanName || 'Artisan'}. 
They are currently on this page route: "${currentRoute || '/dashboard'}"

I have provided an audio recording of them speaking. 
Listen to the audio, figure out what they are asking or saying, and respond directly to them as an assistant.

CRITICAL KNOWLEDGE:
- If they ask about "PM Vishwakarma" or "schemes", explicitly mention: "You get a ₹15,000 toolkit incentive, collateral-free credit at 5% interest, and skill training. I can auto-apply for you."
- If they ask about ONDC, mention: "ONDC allows you to sell directly to buyers nationwide."

OUTPUT FORMAT:
You MUST return a pure JSON object (no markdown formatting) with exactly two keys:
1. "transcript": The text of what the user said in the audio (translate to English if necessary, or keep in original language).
2. "response": Your 1-2 sentence response guiding them. 
CRITICAL INSTRUCTION for response: You MUST respond in the native script for language code '${language}' (e.g. use proper Odia script for 'or', proper Devanagari for 'hi', proper English for 'en'). Do NOT transliterate. Provide the actual native characters.`;

    let responseText = "I have noted your request.";
    let transcriptText = "Audio received.";

    try {
      console.log("[Gemini API] Sending Audio + Prompt for unified STT and generation...");
      
      // We pass the prompt AND the audio file as inlineData
      const contents = [
        prompt,
        {
          inlineData: {
            mimeType: "audio/webm",
            data: base64Data
          }
        }
      ];

      const result = await generateContentWithFallback(contents, {
        responseMimeType: "application/json"
      });
      
      if (result && result.text) {
        const parsed = JSON.parse(result.text);
        transcriptText = parsed.transcript || transcriptText;
        responseText = parsed.response || responseText;
      }
    } catch (llmError) {
      console.error("Gemini LLM Error:", llmError);
      return NextResponse.json({ success: false, error: 'Gemini AI failed to process audio' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      transcript: transcriptText,
      response: responseText
    });
    
  } catch (error: any) {
    console.error('Transcription error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
