import { NextResponse } from "next/server";
import { generateContentWithFallback } from '@/lib/gemini';

export async function POST(req: Request) {
  try {
    const { message, craftType } = await req.json();

    const prompt = `
      You are an expert business and learning assistant for Indian rural artisans.
      The artisan's craft is: ${craftType}.
      The artisan says: "${message}"
      
      Respond directly to them in simple, encouraging English (or Hinglish if appropriate). Keep it under 4 sentences.
      
      If they are asking to learn a new technique, improve their skills, or solve a specific problem, generate a highly specific YouTube search query that would find a good tutorial for them. For example, if they ask how to draw a Pattachitra border, the query should be "how to draw pattachitra border step by step".
      If their request doesn't need a video (e.g. just saying hello), omit the youtubeQuery field entirely.
      
      Return your response as a JSON object with this exact format, with NO Markdown wrapping, just raw JSON:
      {
         "reply": "Your conversational reply here",
         "youtubeQuery": "A specific search query to find a tutorial on youtube"
      }
    `;

    const result = await generateContentWithFallback(
      [{ text: prompt }],
      {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            reply: { type: "STRING" },
            youtubeQuery: { type: "STRING" }
          },
          required: ["reply"]
        }
      }
    );

    const rawText = typeof result === 'string' ? result : (result as { text?: string })?.text || '{}';
    let parsed: any = { reply: "I'm sorry, I couldn't process that." };
    
    try {
      parsed = JSON.parse(rawText.trim().replace(/^`(?:json)?\s*/i, '').replace(/`\s*$/, ''));
    } catch (e) {
      console.error("Failed to parse Gemini response:", rawText);
    }

    // Perform dynamic youtube search if a query was generated
    if (parsed.youtubeQuery) {
      try {
        // &sp=CAM%253D sorts YouTube search results strictly by View Count (Highest engagement)
        const ytRes = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(parsed.youtubeQuery)}&sp=CAM%253D`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });
        const html = await ytRes.text();
        const matches = [...html.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"/g)];
        const uniqueVideoIds = [...new Set(matches.map(m => m[1]))].slice(0, 10);
        
        for (const vid of uniqueVideoIds) {
          // Verify if the video allows external embedding via the oEmbed endpoint
          const oembedRes = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${vid}&format=json`);
          if (oembedRes.ok) {
            parsed.videoId = vid;
            break; // We found the highest-viewed, fully playable video!
          }
        }
      } catch (err) {
        console.error("Failed to scrape YouTube:", err);
      }
    }

    return NextResponse.json(parsed);
  } catch (error) {
    console.error("Gemini Chat API Error:", error);
    return NextResponse.json({ reply: "I'm sorry, I couldn't connect right now. Please try again." }, { status: 500 });
  }
}
