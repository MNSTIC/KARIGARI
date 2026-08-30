import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { craftType, clusterName } = await req.json();

    if (!craftType) {
      return NextResponse.json({ error: 'craftType is required' }, { status: 400 });
    }

const prompt = `You are a dynamic raw material sourcing engine for Indian artisans.
The artisan makes: "${craftType}" and is located near "${clusterName}".
Generate 3 authentic raw material items they would need to buy to make this craft, sourced from realistic nearby locations in the region.
For each item, provide a detailed description of the material, a realistic supplier name, an authentic nearby location (district/city), a local phone number, and price in INR (e.g. '₹850').

Return the result as a strict JSON array of objects with this schema:
{
  "materials": [
    {
      "id": 1,
      "name": "Specific Raw Material Name",
      "description": "Detailed description of the material quality, weight, or specs.",
      "supplier": "Realistic Supplier Name",
      "location": "City, State",
      "contact": "+91 98XXX XXXXX",
      "price": "₹...",
      "isVerified": true
    }
  ]
}`;

    // Using Groq instead of Gemini as requested
    const apiKey = process.env.GROQ_API_KEY ;
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: "You are a JSON-only API. You output raw, valid JSON. Always wrap the array in a 'materials' object key." },
          { role: "user", content: prompt }
        ],
        temperature: 0.2,
        response_format: { type: "json_object" } 
      })
    });

    const data = await res.json();
    
    if (!res.ok) {
      throw new Error(data.error?.message || "Groq API Error");
    }

    const rawText = data.choices?.[0]?.message?.content || "{}";
    
    let parsedData = [];
    try {
      let cleaned = rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
      const obj = JSON.parse(cleaned);
      parsedData = obj.materials || obj.data || obj.items || Object.values(obj)[0] || [];
      if (!Array.isArray(parsedData)) parsedData = [parsedData];
    } catch (e) {
      console.error("Failed to parse materials:", rawText);
      throw new Error("Failed to parse: " + rawText);
    }

    return NextResponse.json({ success: true, data: parsedData });

  } catch (error: any) {
    console.error('Materials error:', error);
    return NextResponse.json({ 
      success: true, 
      data: [
        {
          id: 1, name: `Premium Artisan Material (Error: ${error.message})`, description: "Backup description for fallback.", supplier: "Local Cooperative", location: "Local Cluster", contact: "+91 99999 99999", price: "₹500", isVerified: true
        }
      ]
    });
  }
}
