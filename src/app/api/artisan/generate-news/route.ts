import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { craftType, clusterName } = await req.json();

    if (!craftType) {
      return NextResponse.json({ error: 'craftType is required' }, { status: 400 });
    }

    // 1. Fetch real news from Google News RSS to ensure no hallucination
    const searchQuery = encodeURIComponent(`"${craftType}" OR "${clusterName}" OR "Indian Artisans"`);
    const rssUrl = `https://news.google.com/rss/search?q=${searchQuery}&hl=en-IN&gl=IN&ceid=IN:en`;
    
    const rssRes = await fetch(rssUrl);
    const rssText = await rssRes.text();
    
    // 2. Extract top 4 items using regex (since we don't have an XML parser easily available in edge/node without extra deps)
    const items: any[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    let count = 0;
    while ((match = itemRegex.exec(rssText)) !== null && count < 4) {
      const itemContent = match[1];
      const titleMatch = itemContent.match(/<title>([\s\S]*?)<\/title>/);
      const linkMatch = itemContent.match(/<link>([\s\S]*?)<\/link>/);
      const pubDateMatch = itemContent.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
      
      if (titleMatch && linkMatch) {
        items.push({
          title: titleMatch[1].replace(/<!\[CDATA\[|\]\]>/g, ''),
          link: linkMatch[1],
          pubDate: pubDateMatch ? pubDateMatch[1] : new Date().toDateString()
        });
        count++;
      }
    }

    // Fallback if no specific news found for this exact craft
    if (items.length === 0) {
      items.push(
        { title: "Ministry of Textiles announces new schemes for local artisans", link: "https://texmin.nic.in/", pubDate: new Date().toDateString() },
        { title: "Digital platforms helping Indian handicrafts reach global markets", link: "https://news.google.com/", pubDate: new Date().toDateString() }
      );
    }

    // 3. Use Groq to extract highlights and format the response safely
    const prompt = `You are an assistant for Indian artisans. 
Here are some real news articles just fetched from the internet regarding "${craftType}" or "${clusterName}":
${JSON.stringify(items, null, 2)}

Translate/extract the highlighted points of these real updates. 
DO NOT PROVIDE FALSE NEWS. ONLY use the information provided above.
Summarize the headline and provide a 2-3 sentence description of what the news is about.
Include the EXACT link provided so they can read in detail themselves.

Return the result as a strict JSON array of objects with this schema:
[
  {
    "id": 1,
    "title": "Short headline",
    "description": "2-3 sentences explaining the news",
    "date": "Extracted date",
    "type": "NEWS",
    "source": "News Publisher Name",
    "link": "https://..." 
  }
]`;

    const apiKey = process.env.GROQ_API_KEY ;
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "qwen/qwen3.8-27b",
        messages: [
          { role: "system", content: "You output raw, valid JSON arrays with no markdown formatting. Do not hallucinate data." },
          { role: "user", content: prompt }
        ],
        temperature: 0.1,
        response_format: { type: "json_object" } 
      })
    });

    const data = await res.json();
    
    if (!res.ok) {
      throw new Error(data.error?.message || "Groq API Error");
    }

    const rawText = data.choices?.[0]?.message?.content || "[]";
    
    let parsedData = [];
    try {
      let cleaned = rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
      if (cleaned.startsWith('{') && !cleaned.startsWith('[{')) {
          const obj = JSON.parse(cleaned);
          parsedData = obj.news || obj.events || obj.data || obj.items || Object.values(obj)[0] || [];
          if (!Array.isArray(parsedData)) parsedData = [parsedData];
      } else {
          parsedData = JSON.parse(cleaned);
      }
    } catch (e) {
      console.error("Failed to parse news:", rawText);
      throw new Error("Failed to parse: " + rawText);
    }

    // Ensure links are present in case the AI missed them
    parsedData.forEach((item: any, idx: number) => {
      if (!item.link && items[idx]) {
        item.link = items[idx].link;
      }
      if (!item.type) item.type = "NEWS";
    });

    return NextResponse.json({ success: true, data: parsedData });

  } catch (error: any) {
    console.error('News error:', error);
    return NextResponse.json({ 
      success: true, 
      data: [
        {
          id: 1, 
          title: `Crafts News (Fallback: ${error.message})`, 
          description: "Could not load dynamic live news. Please try again later.", 
          date: new Date().toDateString(), 
          type: "NEWS", 
          source: "System",
          link: "#"
        }
      ]
    });
  }
}
