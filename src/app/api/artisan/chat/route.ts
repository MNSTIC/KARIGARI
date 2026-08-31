import { NextResponse } from 'next/server';
import { GroqError, groqChatJSON, languageInstruction, languageName } from '@/lib/groq';

/**
 * Learn & Grow assistant.
 *
 * Runs on Groq (`groqChatJSON`), like the raw-materials and live-news surfaces.
 * Answers in the artisan's chosen language and, when they are asking to learn
 * something, finds one genuinely relevant tutorial.
 *
 * The video pick used to regex every `"videoId"` out of the YouTube results
 * HTML — which sweeps up promoted slots, sidebar mixes and shelf entries — and
 * sorted by view count (`sp=CAM…`), so the artisan got the biggest video on
 * YouTube rather than the one that answered their question. Both are fixed
 * below: relevance order, and only real search results.
 */
export const dynamic = 'force-dynamic';

/**
 * Shown when the model cannot be reached. Written per language here rather than
 * pulled from the client dictionary, which is a 170 KB client module.
 */
const UNAVAILABLE: Record<string, string> = {
  en: "I can't reach my AI service right now. Please try again in a moment.",
  hi: 'मैं अभी अपनी AI सेवा से नहीं जुड़ पा रहा हूँ। कृपया थोड़ी देर बाद पुनः प्रयास करें।',
  or: 'ମୁଁ ବର୍ତ୍ତମାନ ମୋର AI ସେବା ସହ ଯୋଗାଯୋଗ କରିପାରୁ ନାହିଁ। ଦୟାକରି କିଛି ସମୟ ପରେ ପୁନଃ ଚେଷ୍ଟା କରନ୍ତୁ।',
  te: 'నేను ప్రస్తుతం నా AI సేవను చేరుకోలేకపోతున్నాను. దయచేసి కొద్దిసేపటి తర్వాత మళ్ళీ ప్రయత్నించండి.',
};

function unavailableMessage(code: string): string {
  return UNAVAILABLE[(code || 'en').toLowerCase()] || UNAVAILABLE.en;
}

const YT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** A video is only offered if YouTube says it can actually be embedded. */
async function isEmbeddable(videoId: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
      { cache: 'no-store' }
    );
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Preferred path: the official Data API, which returns relevance-ranked results
 * and can filter to embeddable videos server-side. Needs `YOUTUBE_API_KEY`.
 */
async function searchViaDataApi(query: string): Promise<string[]> {
  const key = process.env.YOUTUBE_API_KEY?.trim();
  if (!key) return [];

  try {
    const url =
      `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video` +
      `&videoEmbeddable=true&maxResults=5&q=${encodeURIComponent(query)}&key=${key}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      console.warn('[chat] YouTube Data API failed:', res.status);
      return [];
    }
    const data = await res.json();
    return (data?.items ?? [])
      .map((item: { id?: { videoId?: string } }) => item?.id?.videoId)
      .filter((id: unknown): id is string => typeof id === 'string');
  } catch (error) {
    console.warn('[chat] YouTube Data API error:', (error as Error)?.message);
    return [];
  }
}

/**
 * Fallback: read the `ytInitialData` blob and walk only the real search-result
 * list, in the order YouTube ranked it.
 *
 * `itemSectionRenderer` holds the organic results. `promotedVideoRenderer`,
 * `compactVideoRenderer` (sidebar) and shelf/mix wrappers are skipped — those
 * are exactly the entries the old blanket regex was picking up.
 */
async function searchViaScrape(query: string): Promise<string[]> {
  try {
    const res = await fetch(
      `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
      { headers: { 'User-Agent': YT_UA }, cache: 'no-store' }
    );
    if (!res.ok) return [];
    const html = await res.text();

    const start = html.indexOf('var ytInitialData = ');
    if (start === -1) return [];
    const jsonStart = start + 'var ytInitialData = '.length;
    const end = html.indexOf('};', jsonStart);
    if (end === -1) return [];

    let data: unknown;
    try {
      data = JSON.parse(html.slice(jsonStart, end + 1));
    } catch {
      return [];
    }

    const ids: string[] = [];

    // Depth-first walk that only descends into organic result containers.
    const visit = (node: unknown): void => {
      if (ids.length >= 6 || !node || typeof node !== 'object') return;

      if (Array.isArray(node)) {
        for (const child of node) visit(child);
        return;
      }

      const obj = node as Record<string, unknown>;

      // Promoted slots and sidebar/mix entries are not search results.
      if (obj.promotedVideoRenderer || obj.compactVideoRenderer || obj.adSlotRenderer) return;

      const video = obj.videoRenderer as { videoId?: unknown } | undefined;
      if (video && typeof video.videoId === 'string') {
        if (!ids.includes(video.videoId)) ids.push(video.videoId);
        return;
      }

      for (const value of Object.values(obj)) visit(value);
    };

    visit(data);
    return ids;
  } catch (error) {
    console.warn('[chat] YouTube scrape error:', (error as Error)?.message);
    return [];
  }
}

/** First relevance-ranked, embeddable video for the query, or null. */
async function findTutorial(query: string): Promise<string | null> {
  const candidates = (await searchViaDataApi(query)) || [];
  const ids = candidates.length > 0 ? candidates : await searchViaScrape(query);

  for (const id of ids.slice(0, 5)) {
    if (await isEmbeddable(id)) return id;
  }
  return null;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const message = typeof body?.message === 'string' ? body.message.trim() : '';
    const craftType =
      typeof body?.craftType === 'string' && body.craftType.trim()
        ? body.craftType.trim()
        : 'traditional Indian handicraft';
    const language = typeof body?.language === 'string' ? body.language : 'en';

    if (!message) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 });
    }

    const prompt = `You are an expert business and learning assistant for Indian rural artisans.
The artisan's craft is: ${craftType}.
The artisan says: "${message}"

Respond directly to them in simple, encouraging language. Keep it under 4 sentences.
${languageInstruction(language)}

If they are asking to learn a new technique, improve their skills, or solve a specific problem,
generate a highly specific YouTube search query for a tutorial. The query MUST be written in
English (YouTube search works best in English), MUST mention "${craftType}", and MUST end with
"tutorial" or "how to". Example: "${craftType} border design tutorial step by step".
If their request does not need a video (e.g. just saying hello), omit the youtubeQuery field.

Return a JSON object in exactly this shape:
{
  "reply": "Your conversational reply, written in ${languageName(language)}",
  "youtubeQuery": "An English search query to find a tutorial on youtube"
}`;

    let parsed: {
      reply?: string;
      youtubeQuery?: string;
      videoId?: string | null;
      searchUrl?: string;
    };

    try {
      parsed = await groqChatJSON<{ reply?: string; youtubeQuery?: string }>(prompt, {
        system:
          'You are a JSON-only API for Indian artisans. You output raw, valid JSON with no markdown formatting.',
        temperature: 0.4,
      });
    } catch (error) {
      const err = error as GroqError;
      console.error('Chat model unavailable:', err?.message);
      // A visible sentence, never an empty bubble. 200 so the modal renders it
      // as a normal assistant turn rather than a network failure.
      return NextResponse.json({
        reply: unavailableMessage(language),
        videoId: null,
      });
    }

    if (parsed.youtubeQuery) {
      // Belt and braces: even if the model forgets, keep the craft in the query
      // so a generic "how to weave" cannot return an unrelated craft.
      const query = parsed.youtubeQuery.toLowerCase().includes(craftType.toLowerCase())
        ? parsed.youtubeQuery
        : `${craftType} ${parsed.youtubeQuery}`;

      parsed.videoId = await findTutorial(query);
      // No embeddable match — the modal offers this link instead of a random video.
      parsed.searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    }

    return NextResponse.json(parsed);
  } catch (error) {
    console.error('Chat API error:', error);
    return NextResponse.json({ reply: unavailableMessage('en'), videoId: null }, { status: 500 });
  }
}
