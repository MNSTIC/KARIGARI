import { NextResponse } from 'next/server';
import { GroqError, firstArray, groqChatJSON, languageInstruction } from '@/lib/groq';
import { suppliersForCraft, type CuratedSupplier } from '@/lib/suppliers';

/**
 * Raw-material sourcing for one craft: a curated base, plus AI on top.
 *
 * The curated directory (`src/lib/suppliers.ts`) is what the artisan sees no
 * matter what — it is static, it needs no key, and it does not vary run to run.
 * The Groq route then adds whatever it can for the specific craft and cluster,
 * and the two are merged and de-duplicated by supplier name.
 *
 * The honesty rule is unchanged and now applies to both halves: an AI failure
 * never becomes a row. It used to return `success: true` with a single
 * fabricated supplier whose name embedded the raw exception text, which read to
 * the artisan as a genuine lead. Now a model failure simply means the response
 * carries the curated rows and a `degraded` flag, and if the curated list is
 * somehow empty too the route says so with `success: false`.
 *
 * Curated rows travel with `sample: true`. They describe real material trades
 * in real districts, but the business names and numbers are illustrative — see
 * the honesty note at the top of `src/lib/suppliers.ts` — and the page is
 * required to say so rather than implying KARIGARI verified them.
 */
export const dynamic = 'force-dynamic';

/** The row shape the materials page renders. Both halves normalise to this. */
interface MaterialRow {
  id: string;
  name: string;
  description: string;
  supplier: string;
  location: string;
  contact: string;
  price: string;
  isVerified: boolean;
  bulk?: boolean;
  minOrder?: string;
  /** 'curated' rows come from our own directory; 'ai' rows from the model. */
  source: 'curated' | 'ai';
  /** True where the business name and number are illustrative, not verified. */
  sample: boolean;
}

function fromCurated(supplier: CuratedSupplier, index: number): MaterialRow {
  return {
    id: `curated-${index}`,
    name: supplier.material,
    description: supplier.description,
    supplier: supplier.name,
    location: supplier.location,
    contact: supplier.phone,
    price: supplier.priceRange,
    isVerified: supplier.verified,
    bulk: Boolean(supplier.minOrder),
    minOrder: supplier.minOrder,
    source: 'curated',
    sample: true,
  };
}

/** Normalise one model row, dropping anything without a supplier to name. */
function fromAi(row: unknown, index: number): MaterialRow | null {
  if (!row || typeof row !== 'object') return null;
  const record = row as Record<string, unknown>;
  const text = (key: string): string => {
    const value = record[key];
    return typeof value === 'string' ? value.trim() : '';
  };

  const supplier = text('supplier');
  const name = text('name');
  if (!supplier || !name) return null;

  return {
    id: `ai-${index}`,
    name,
    description: text('description'),
    supplier,
    location: text('location'),
    contact: text('contact'),
    price: text('price'),
    isVerified: record.isVerified !== false,
    bulk: record.bulk === true || Boolean(text('minOrder')),
    minOrder: text('minOrder') || undefined,
    source: 'ai',
    // The model is asked for realistic names, which is exactly what makes them
    // unverified. Flagged the same way the curated rows are.
    sample: true,
  };
}

/** Two rows are the same supplier if their names match once cased and trimmed. */
function dedupe(rows: MaterialRow[]): MaterialRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = row.supplier.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const craftType = typeof body?.craftType === 'string' ? body.craftType.trim() : '';
  const clusterName = typeof body?.clusterName === 'string' ? body.clusterName.trim() : '';
  const language = typeof body?.language === 'string' ? body.language : 'en';

  if (!craftType) {
    return NextResponse.json({ success: false, error: 'craftType is required' }, { status: 400 });
  }

  // The base list, computed before the model is even asked. Whatever happens
  // next, the artisan gets these.
  const curated = suppliersForCraft(craftType).map(fromCurated);

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

  let aiRows: MaterialRow[] = [];
  let degraded: string | null = null;

  try {
    const parsed = await groqChatJSON<Record<string, unknown>>(prompt, {
      system:
        "You are a JSON-only API. You output raw, valid JSON. Always wrap the array in a 'materials' object key.",
      temperature: 0.2,
    });

    aiRows = firstArray(parsed)
      .map((row, index) => fromAi(row, index))
      .filter((row): row is MaterialRow => row !== null);

    if (aiRows.length === 0) {
      degraded = 'The sourcing model returned no extra suppliers this time.';
    }
  } catch (error) {
    const err = error as GroqError;
    console.error('Materials error:', err?.message);
    // Honest failure. No invented supplier, no error text dressed up as a row —
    // the curated list still renders, and the flag says why it is only that.
    degraded =
      err?.name === 'GroqError' && err.status === 503
        ? 'AI sourcing is not configured, so this is the curated directory only.'
        : 'Could not reach the AI sourcing model, so this is the curated directory only.';
  }

  // Curated first: it is the half we can stand behind as a description of the
  // trade, and it is the half that is there every time.
  const data = dedupe([...curated, ...aiRows]);

  if (data.length === 0) {
    return NextResponse.json(
      { success: false, error: degraded || 'Could not load raw material suggestions right now.' },
      { status: 502 }
    );
  }

  return NextResponse.json({
    success: true,
    data,
    curatedCount: curated.length,
    aiCount: aiRows.length,
    degraded,
  });
}
