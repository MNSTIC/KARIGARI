const fs = require('fs');

const transcribeCode = `import { NextResponse } from 'next/server';
import { generateContentWithFallback } from '@/lib/gemini';

export async function POST(req: Request) {
  try {
    const { audio, language, artisanName, currentRoute } = await req.json();
    
    if (!audio) {
      return NextResponse.json({ success: false, error: 'No audio provided' }, { status: 400 });
    }

    const openAiKey = process.env.OPENAI_API_KEY;
    let transcriptText = "";

    if (!openAiKey) {
      console.log("[Whisper API] OPENAI_API_KEY missing. Simulating transcription...");
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      transcriptText = "I need help with government schemes. What are the benefits of PM Vishwakarma?";
      if (language === 'hi') transcriptText = "मुझे सरकारी योजनाओं में मदद चाहिए। पीएम विश्वकर्मा के क्या लाभ हैं?";
      if (language === 'or') transcriptText = "ମୋତେ ସରକାରୀ ଯୋଜନା ବିଷୟରେ ସାହାଯ୍ୟ ଦରକାର। ପିଏମ୍ ବିଶ୍ୱକର୍ମାର ଲାଭ କ'ଣ?";
    } else {
      const base64Data = audio.replace(/^data:audio\\/\\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");
      
      const formData = new FormData();
      const blob = new Blob([buffer], { type: 'audio/webm' });
      formData.append('file', blob, 'audio.webm');
      formData.append('model', 'whisper-1');
      
      console.log("[Whisper API] Calling api.openai.com/v1/audio/transcriptions");
      const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': \`Bearer \${openAiKey}\`
        },
        body: formData
      });

      if (!whisperRes.ok) {
        const err = await whisperRes.json();
        console.error("Whisper API Error:", err);
        return NextResponse.json({ success: false, error: 'Whisper transcription failed' }, { status: 500 });
      }

      const whisperData = await whisperRes.json();
      transcriptText = whisperData.text;
    }

    // Call Gemini for truly dynamic response
    const prompt = \`You are a helpful, extremely concise, and encouraging voice assistant for the 'Karigari' app.
Your user is a marginalized Indian artisan named \${artisanName || 'Artisan'}. 
They are currently on this page route: "\${currentRoute || '/dashboard'}"
They just said this to you via voice typing: "\${transcriptText}"

CRITICAL KNOWLEDGE:
- If they ask about "PM Vishwakarma" or "schemes", explicitly mention: "You get a ₹15,000 toolkit incentive, collateral-free credit at 5% interest, and skill training. I can auto-apply for you."
- If they ask about ONDC, mention: "ONDC allows you to sell directly to buyers nationwide."

Based on the page they are on and what they said, guide them appropriately. Be very brief (1-2 sentences max).
CRITICAL INSTRUCTION: You MUST respond in the native script for language code '\${language}' (e.g. use proper Odia script for 'or', proper Devanagari for 'hi', proper English for 'en'). Do NOT transliterate. Provide the actual native characters so it displays correctly on screen.\`;

    let responseText = "I have noted your request.";
    try {
      const result = await generateContentWithFallback(
        [{ text: prompt }],
        { responseMimeType: "text/plain" }
      );
      if (result && result.text) {
        responseText = result.text.replace(/\\*/g, ''); // Remove markdown bolding for clean TTS
      }
    } catch (llmError) {
      console.error("Gemini LLM Error:", llmError);
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
`;

fs.writeFileSync('src/app/api/transcribe/route.ts', transcribeCode);
