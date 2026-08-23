import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { audio, language, artisanName, currentRoute } = await req.json();
    
    if (!audio) {
      return NextResponse.json({ success: false, error: 'No audio provided' }, { status: 400 });
    }

    const openAiKey = process.env.OPENAI_API_KEY;
    let transcriptText = "";

    // Hackathon fallback: If no API key is set, we gracefully fallback to simulated STT
    // rather than breaking the demo on stage.
    if (!openAiKey) {
      console.log("[Whisper API] OPENAI_API_KEY missing. Simulating transcription...");
      await new Promise(resolve => setTimeout(resolve, 1500)); // Simulate latency
      
      transcriptText = "This is a beautiful handwoven saree. It took me 5 days to weave and the raw materials cost around 1500 rupees.";
      if (language === 'hi') transcriptText = "यह एक सुंदर हाथ से बुनी साड़ी है। इसे बनाने में 5 दिन लगे और सामग्री की लागत लगभग 1500 रुपये थी।";
      if (language === 'or') transcriptText = "ଏହା ଏକ ସୁନ୍ଦର ହାତବୁଣା ଶାଢ଼ୀ। ଏହାକୁ ବୁଣିବା ପାଇଁ ୫ ଦିନ ଲାଗିଲା ଏବଂ କଞ୍ଚାମାଲ ମୂଲ୍ୟ ପ୍ରାୟ ୧୫୦୦ ଟଙ୍କା ଥିଲା।";
    } else {
      // 1. Convert base64 back to a blob
      const base64Data = audio.replace(/^data:audio\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");
      
      // 2. Prepare FormData for OpenAI
      const formData = new FormData();
      const blob = new Blob([buffer], { type: 'audio/webm' });
      formData.append('file', blob, 'audio.webm');
      formData.append('model', 'whisper-1');
      
      // Optionally restrict language to improve accuracy
      // if (language === 'hi') formData.append('language', 'hi');

      // 3. Call OpenAI Whisper API
      console.log("[Whisper API] Calling api.openai.com/v1/audio/transcriptions");
      const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openAiKey}`
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

    // Now forward the transcript to the existing Voice Assistant LLM endpoint
    // We can simulate the NLP engine response here for simplicity based on the transcript
    
    // Simulate NLP Response based on route
    let response = "I have noted those details for your listing.";
    
    if (transcriptText.toLowerCase().includes("ondc") || transcriptText.toLowerCase().includes("ओएनडीसी") || transcriptText.toLowerCase().includes("ଓଏନଡିସି")) {
      response = "ONDC stands for Open Network for Digital Commerce. It allows you to sell directly to buyers. You just earned the Level 1 Digital Merchant badge!";
    } else if (currentRoute?.includes("insights")) {
      response = "I have filtered the demand map based on your query.";
    } else if (currentRoute?.includes("schemes")) {
      if (transcriptText.toLowerCase().includes('vishwakarma') || transcriptText.toLowerCase().includes('benefit') || transcriptText.toLowerCase().includes('what') || transcriptText.toLowerCase().includes('scheme')) {
         if (language === 'hi') {
            response = 'पीएम विश्वकर्मा योजना के तहत आपको ₹15,000 का टूलकिट, 5% ब्याज पर ऋण और कौशल प्रशिक्षण मिलता है। क्या मैं आपके लिए ऑटो-अप्लाई कर दूँ?';
         } else if (language === 'or') {
            response = 'ପିଏମ୍ ବିଶ୍ୱକର୍ମା ଯୋଜନାରେ ଆପଣଙ୍କୁ ₹୧୫,୦୦୦ ର ଟୁଲକିଟ୍, ୫% ସୁଧରେ ଋଣ ଏବଂ ଦକ୍ଷତା ତାଲିମ ମିଳିବ। ମୁଁ ଆପଣଙ୍କ ପାଇଁ ଅଟୋ-ଅପ୍ଲାଏ କରିଦେବି କି?';
         } else {
            response = 'Under the PM Vishwakarma Yojana, you get a ₹15,000 toolkit incentive, collateral-free credit at 5% interest, and skill training. Shall I auto-apply for you?';
         }
      } else {
         response = 'I will help you apply for this scheme using your verified Aadhaar profile. Just click the Auto-Apply button.';
      }

    } else {
       if (language === 'hi') response = "मैंने आपकी सूची के लिए वे विवरण नोट कर लिए हैं।";
       if (language === 'or') response = "ମୁଁ ଆପଣଙ୍କ ତାଲିକା ପାଇଁ ସେହି ବିବରଣୀଗୁଡିକ ନୋଟ୍ କରିଛି।";
    }

    return NextResponse.json({
      success: true,
      transcript: transcriptText,
      response: response
    });
    
  } catch (error: any) {
    console.error('Transcription error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
