import { NextResponse } from 'next/server';
import { GroqError, firstArray, groqChatJSON, languageInstruction } from '@/lib/groq';

/**
 * Live craft-sector news for one artisan.
 *
 * The headlines are real: they come from a Google News RSS query, and the model
 * is only allowed to summarise and translate what it is handed. It never
 * invents a story. When the model is unreachable this returns `success: false`
 * so the page can offer a retry — previously it returned a single fake article
 * whose title contained the raw exception message.
 */
export const dynamic = 'force-dynamic';

interface RssItem {
  title: string;
  link: string;
  pubDate: string;
}

/** Pull the first `limit` <item> blocks out of an RSS feed without a parser dep. */
function parseRss(xml: string, limit: number): RssItem[] {
  const items: RssItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null && items.length < limit) {
    const block = match[1];
    const title = block.match(/<title>([\s\S]*?)<\/title>/);
    const link = block.match(/<link>([\s\S]*?)<\/link>/);
    const pubDate = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
    if (title && link) {
      items.push({
        title: title[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim(),
        link: link[1].trim(),
        pubDate: pubDate ? pubDate[1].trim() : new Date().toDateString(),
      });
    }
  }
  return items;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const craftType = typeof body?.craftType === 'string' ? body.craftType.trim() : '';
  const clusterName = typeof body?.clusterName === 'string' ? body.clusterName.trim() : '';
  const language = typeof body?.language === 'string' ? body.language : 'en';

  if (!craftType) {
    return NextResponse.json({ success: false, error: 'craftType is required' }, { status: 400 });
  }

  /**
   * Craft-anchored search.
   *
   * The old query OR-ed the cluster name in as a standalone term, so an artisan
   * whose cluster reads "Independent" was served political stories about
   * independent MLAs. Every term is now qualified by the craft sector, and the
   * cluster is only added when it looks like a real place name rather than a
   * generic word.
   */
  const GENERIC_CLUSTERS = /^(independent|local|artisan cluster|local artisan cluster|n\/a|none)$/i;
  const usableCluster = clusterName && !GENERIC_CLUSTERS.test(clusterName) ? clusterName : '';

  const queries = [
    // Most specific: this craft, in the handloom/handicraft sector.
    `"${craftType}" (handloom OR handicraft OR artisan OR weaver)`,
    // Then the cluster, still anchored to crafts so a place name alone cannot
    // pull in unrelated local news.
    ...(usableCluster ? [`"${usableCluster}" (handloom OR handicraft OR artisan)`] : []),
    // Last resort: the sector at large, which is always on-topic.
    'Indian handloom handicraft artisans scheme',
  ];

  let items: RssItem[] = [];
  for (const query of queries) {
    try {
      const rssRes = await fetch(
        `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`,
        { cache: 'no-store' }
      );
      if (rssRes.ok) items = parseRss(await rssRes.text(), 4);
    } catch (error) {
      console.warn('News RSS fetch failed:', (error as Error)?.message);
    }
    if (items.length > 0) break;
  }

  // Real, checkable fallbacks — government sources, not invented headlines.
  if (items.length === 0) {
    items = [
      {
        title: 'Ministry of Textiles — schemes and notices for handloom artisans',
        link: 'https://texmin.nic.in/',
        pubDate: new Date().toDateString(),
      },
      {
        title: 'Office of the Development Commissioner (Handicrafts)',
        link: 'https://handicrafts.nic.in/',
        pubDate: new Date().toDateString(),
      },
    ];
  }

  const prompt = `You are an assistant for Indian artisans.
Here are real news articles just fetched from the internet about the ${craftType} craft sector${usableCluster ? ` in ${usableCluster}` : ''}:
${JSON.stringify(items, null, 2)}

Summarise ONLY the articles above. DO NOT invent news. Use the EXACT link provided for each item.
For each, give a short headline and a 2-3 sentence description of what it is about.

${languageInstruction(language)}
Keep the "link" values exactly as given — do not translate or alter URLs.

Return a strict JSON object with this schema:
{
  "news": [
    { "id": 1, "title": "Short headline", "description": "2-3 sentences", "date": "Extracted date", "type": "NEWS", "source": "Publisher", "link": "https://..." }
  ]
}`;

  try {
    const parsed = await groqChatJSON<Record<string, unknown>>(prompt, {
      system: 'You output raw, valid JSON with no markdown formatting. Do not hallucinate data.',
      temperature: 0.1,
    });

    const rows = firstArray(parsed) as Record<string, unknown>[];
    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'The summariser returned nothing. Please retry.' },
        { status: 502 }
      );
    }

    // Re-attach the real link and type if the model dropped either.
    rows.forEach((row, index) => {
      if (!row.link && items[index]) row.link = items[index].link;
      if (!row.type) row.type = 'NEWS';
    });

    return NextResponse.json({ success: true, data: rows });
  } catch (error) {
    const err = error as GroqError;
    console.error('News error:', err?.message);
    return NextResponse.json(
      {
        success: false,
        error:
          err?.name === 'GroqError' && err.status === 503
            ? 'AI service not configured.'
            : 'Could not load live news right now.',
        // The real headlines are still worth handing back so the page can link
        // out even when the summariser is down.
        headlines: items,
      },
      { status: err?.status ?? 502 }
    );
  }
}
