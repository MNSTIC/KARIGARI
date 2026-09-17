import { prisma } from '@/lib/prisma';
import {
  SEARCH_REPEAT_WINDOW_MINUTES,
  normaliseSearchTerm,
  saltedIpHash,
} from '@/lib/searchLog';

export const dynamic = 'force-dynamic';

/**
 * Record one storefront search. Public — buyers have no account.
 *
 * Always answers 204, whatever happens: this is a side effect of a shopper
 * typing, and a logging endpoint must never put an error in front of them. The
 * storefront calls it after the term has settled, with `keepalive`, and never
 * waits on it.
 *
 * A term shorter than MIN_SEARCH_TERM_LENGTH is ignored, and the same term from
 * the same visitor inside SEARCH_REPEAT_WINDOW_MINUTES is written once, so one
 * person refreshing a page does not become a trend.
 */

const NO_CONTENT = () => new Response(null, { status: 204 });

/** Results are counted in the browser; clamp so a forged body cannot write nonsense. */
const MAX_RESULT_COUNT = 100_000;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const term = normaliseSearchTerm(body?.term);
    if (!term) return NO_CONTENT();

    const rawCount = Number(body?.resultCount);
    const resultCount = Number.isFinite(rawCount)
      ? Math.min(MAX_RESULT_COUNT, Math.max(0, Math.round(rawCount)))
      : 0;
    const ipHash = saltedIpHash(req);

    const since = new Date(Date.now() - SEARCH_REPEAT_WINDOW_MINUTES * 60_000);
    const repeat = await prisma.marketplaceSearch.findFirst({
      where: { term, ipHash, createdAt: { gte: since } },
      select: { id: true },
    });
    if (repeat) return NO_CONTENT();

    await prisma.marketplaceSearch.create({ data: { term, resultCount, ipHash } });
    return NO_CONTENT();
  } catch (error) {
    console.warn('[search-log] not recorded:', (error as Error)?.message);
    return NO_CONTENT();
  }
}
