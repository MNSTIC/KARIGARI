import { NextResponse } from 'next/server';
import { GroqError, firstArray, groqChatJSON, languageInstruction } from '@/lib/groq';

/**
 * Raw-material sourcing suggestions for one craft.
 *
 * These are AI *estimates* of what an artisan would need to buy and roughly
 * what it costs locally — not a live supplier directory. The UI labels them as
 * such. When the model cannot be reached this route returns `success: false`
 * with a real error, so the page can show "couldn't load, retry". It used to
 * return `success: true` with a single fabricated row whose name embedded the
 * raw exception text, which read to the artisan as a genuine supplier.
 */
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const craftType = typeof body?.craftType === 'string' ? body.craftType.trim() : '';
  const clusterName = typeof body?.clusterName === 'string' ? body.clusterName.trim() : '';
  const language = typeof body?.language === 'string' ? body.language : 'en';

  if (!craftType) {
    return NextResponse.json({ success: false, error: 'craftType is required' }, { status: 400 });
  }

  const prompt = `You are a dynamic raw material sourcing engine for Indian artisans.
The artisan makes: "${craftType}" and is located near "${clusterName || 'their local cluster'}".
Generate 3 authentic raw material items they would need to buy to make this craft, sourced from realistic nearby locations in the region.
For each item, provide a detailed description of the material, a realistic supplier name, an authentic nearby location (district/city), a local phone number, and price in INR (e.g. '₹850').

${languageInstruction(language)}

Return the result as a strict JSON object with this schema:
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

  try {
    const parsed = await groqChatJSON<Record<string, unknown>>(prompt, {
      system:
        "You are a JSON-only API. You output raw, valid JSON. Always wrap the array in a 'materials' object key.",
      temperature: 0.2,
    });

    const materials = firstArray(parsed);
    if (materials.length === 0) {
      return NextResponse.json(
        { success: false, error: 'The sourcing model returned no materials. Please retry.' },
        { status: 502 }
      );
    }

    return NextResponse.json({ success: true, data: materials });
  } catch (error) {
    const err = error as GroqError;
    console.error('Materials error:', err?.message);
    // Honest failure. No invented supplier, no error text dressed up as a row.
    return NextResponse.json(
      {
        success: false,
        error:
          err?.name === 'GroqError' && err.status === 503
            ? 'AI service not configured.'
            : 'Could not load raw material suggestions right now.',
      },
      { status: err?.status ?? 502 }
    );
  }
}
