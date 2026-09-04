import { NextResponse } from 'next/server';
import { requireArtisan } from '@/lib/artisanAuth';
import { GroqError, groqChatJSON, isGroqConfigured, languageName } from '@/lib/groq';

/**
 * Step 3 — ONDC catalog generation.
 *
 * Groq-only. Never sees the photo — the previous Gemini call already
 * extracted the craft_details string that this step turns into ONDC RET12
 * copy. That's the whole point of the split: Gemini stays visual, Groq stays
 * textual, and total per-capture cost drops.
 *
 * Never blocks: on Groq failure returns a minimal usable catalog derived from
 * the inputs, so an artisan capturing offline-ish or during a Groq outage
 * still walks out with a listing.
 */
export const dynamic = 'force-dynamic';

interface CatalogResult {
  title_en: string;
  desc_en: string;
  title_regional: string;
  desc_regional: string;
  category: string;
  tags: string[];
}

function trim(value: unknown, max: number, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : fallback;
}

function fallbackCatalog(
  craftType: string,
  craftDetails: string,
  cluster: string
): CatalogResult {
  const title = `${craftType} — ${cluster || 'Handcrafted in India'}`.slice(0, 80);
  const desc =
    `Handcrafted ${craftType.toLowerCase()} made by artisans${
      cluster ? ` in ${cluster}` : ''
    }. ${craftDetails}`.slice(0, 800);
  return {
    title_en: title,
    desc_en: desc,
    title_regional: title,
    desc_regional: desc,
    category: 'Handicrafts',
    tags: [craftType, cluster, 'handmade', 'handicraft', 'artisan']
      .filter(Boolean)
      .slice(0, 5),
  };
}

export async function POST(req: Request) {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}));
  const craftType = trim(body?.craftType, 120);
  const craftDetails = trim(body?.craftDetails, 500);
  const cluster = trim(body?.cluster, 120);
  const language = trim(body?.language, 5, 'en');

  if (!craftType || !craftDetails) {
    return NextResponse.json(
      { success: false, error: 'craftType and craftDetails are required.' },
      { status: 400 }
    );
  }

  const langName = languageName(language);

  // Groq outage → minimal but honest catalog.
  if (!isGroqConfigured()) {
    return NextResponse.json({
      success: true,
      degraded: true,
      reason: 'Groq is not configured — returning derived catalog.',
      catalog: fallbackCatalog(craftType, craftDetails, cluster),
    });
  }

  const prompt = `Generate an ONDC RET12 product catalog entry from this verified craft data.

CRAFT TYPE: "${craftType}"
CLUSTER / LOCATION: "${cluster || 'not specified'}"
VERIFIED DETAILS (from vision pass): "${craftDetails}"

Rules:
- title_en: max 80 characters, SEO-friendly, no ALL CAPS.
- desc_en: max 200 words, factual, emphasise handmade origin and technique.
- title_regional / desc_regional: same content in ${langName}. If ${langName} is English, duplicate.
- category: one short ONDC handicraft category label ("Handicrafts", "Handloom", "Metal craft", "Pottery" etc.).
- tags: exactly 5 short search keywords, single words or two-word phrases.
- Never invent certifications, awards, or a specific artisan name.

Return strict JSON:
{
  "title_en": "",
  "desc_en": "",
  "title_regional": "",
  "desc_regional": "",
  "category": "",
  "tags": []
}`;

  try {
    const parsed = await groqChatJSON<Partial<CatalogResult>>(prompt, { temperature: 0.3 });
    const tagsInput = Array.isArray(parsed.tags) ? parsed.tags : [];
    const tags = tagsInput
      .map((t) => (typeof t === 'string' ? t.trim().slice(0, 30) : ''))
      .filter(Boolean)
      .slice(0, 5);

    const catalog: CatalogResult = {
      title_en: trim(parsed.title_en, 80, `${craftType} — handcrafted`),
      desc_en: trim(parsed.desc_en, 1600, `Handcrafted ${craftType}. ${craftDetails}`),
      title_regional: trim(parsed.title_regional, 80, trim(parsed.title_en, 80, craftType)),
      desc_regional: trim(parsed.desc_regional, 1600, trim(parsed.desc_en, 1600, craftDetails)),
      category: trim(parsed.category, 60, 'Handicrafts'),
      tags: tags.length > 0 ? tags : [craftType, 'handmade', 'handicraft', 'artisan', 'india'],
    };

    return NextResponse.json({ success: true, catalog });
  } catch (error) {
    console.warn('[catalog] Groq failed, falling back:', (error as Error)?.message);
    const status = error instanceof GroqError ? error.status : 502;
    return NextResponse.json(
      {
        success: true,
        degraded: true,
        reason: (error as Error)?.message ?? 'Groq unavailable',
        catalog: fallbackCatalog(craftType, craftDetails, cluster),
      },
      { status: status >= 500 ? 200 : status }
    );
  }
}
