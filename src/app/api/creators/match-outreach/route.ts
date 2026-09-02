import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/prisma';
import { groqChatJSON, GroqError, languageInstruction } from '@/lib/groq';
import { CREATOR_RATE } from '@/lib/escrow';
import { platformLabel, slugifyHandle } from '@/lib/creators';

/**
 * Draft a collaboration message from an artisan to a creator.
 *
 * This is a WRITING AID, not an outbox. Nothing is sent: the artisan reads the
 * draft, edits it, and sends it themselves from their own account. No DM, email
 * or SMS leaves this route, and the UI labels the result as AI-drafted.
 *
 * Groq per the provider policy — the same `groqChatJSON` chain as Raw
 * Materials and Live News.
 */
export const dynamic = 'force-dynamic';

type AuthToken = { userId: string; role: string };

interface Outreach {
  matchScore: number;
  personalizedDm: string;
  targetHashtags: string[];
}

function clampScore(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export async function POST(req: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth-token');
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let decoded: AuthToken;
    try {
      decoded = jwt.verify(token.value, process.env.JWT_SECRET || 'fallback-secret') as AuthToken;
    } catch {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }
    if (decoded.role !== 'ARTISAN') {
      return NextResponse.json({ error: 'Forbidden. Artisan access required.' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const handle = slugifyHandle(typeof body?.handle === 'string' ? body.handle : '');
    const language = typeof body?.language === 'string' ? body.language : 'en';
    if (!handle) {
      return NextResponse.json({ error: 'handle is required.' }, { status: 400 });
    }

    const [creator, artisan] = await Promise.all([
      prisma.creator.findUnique({
        where: { handle },
        select: {
          name: true,
          handle: true,
          platform: true,
          nicheCategory: true,
          location: true,
          bio: true,
          totalClicks: true,
          totalSales: true,
        },
      }),
      prisma.user.findUnique({
        where: { id: decoded.userId },
        select: {
          name: true,
          artisanProfile: {
            select: {
              craftType: true,
              location: true,
              clusterName: true,
              experienceYears: true,
              description: true,
              giTagCertified: true,
              giTagName: true,
            },
          },
        },
      }),
    ]);

    if (!creator) {
      return NextResponse.json({ error: 'No creator with that handle.' }, { status: 404 });
    }

    const profile = artisan?.artisanProfile;
    const craftType = profile?.craftType || 'handmade craft';
    const cluster = profile?.clusterName || profile?.location || 'an Indian artisan cluster';

    const prompt = `An Indian artisan wants to invite a local creator to promote their craft on a 5% affiliate commission.

ARTISAN
- Name: ${artisan?.name || 'An artisan'}
- Craft: ${craftType}
- Cluster / location: ${cluster}
- Years of experience: ${profile?.experienceYears ?? 'unknown'}
- GI tag: ${profile?.giTagCertified ? profile?.giTagName || 'yes' : 'none'}
- About: ${profile?.description || 'not provided'}

CREATOR
- Name: ${creator.name} (@${creator.handle})
- Platform: ${platformLabel(creator.platform)}
- Niche: ${creator.nicheCategory}
- Location: ${creator.location || 'not stated'}
- Bio: ${creator.bio || 'not provided'}
- Track record on Karigari: ${creator.totalClicks} clicks, ${creator.totalSales} sales

Return JSON with exactly these keys:
- "matchScore": integer 0-100, how well this creator's niche, platform and location fit this craft. Be honest: a mismatched niche scores low.
- "personalizedDm": a warm, specific direct message under 90 words the artisan can send. Mention the craft by name, one concrete detail of it, the creator's niche, and that the commission is ${Math.round(
      CREATOR_RATE * 100
    )}% paid directly to the creator's UPI on delivery. Do not invent awards, follower counts, press coverage or sales figures that were not given above.
- "targetHashtags": array of 5-8 lowercase hashtags (with the # prefix) relevant to this craft and niche.

${languageInstruction(language)}`;

    const raw = await groqChatJSON<Partial<Outreach>>(prompt, {
      system:
        'You are a JSON-only API drafting outreach messages for Indian artisans. You never fabricate credentials, follower counts or achievements. You output raw, valid JSON with no markdown.',
      temperature: 0.5,
    });

    const hashtags = Array.isArray(raw?.targetHashtags)
      ? raw.targetHashtags
          .filter((tag): tag is string => typeof tag === 'string')
          .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`))
          .slice(0, 8)
      : [];

    if (typeof raw?.personalizedDm !== 'string' || !raw.personalizedDm.trim()) {
      // No draft is better than an empty box the artisan cannot tell apart
      // from a working one.
      return NextResponse.json(
        { error: 'The AI could not draft a message this time. Try again.' },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        matchScore: clampScore(raw.matchScore),
        personalizedDm: raw.personalizedDm.trim(),
        targetHashtags: hashtags,
      },
      creator: { name: creator.name, handle: creator.handle, platform: creator.platform },
      // The UI must label this. Nothing is sent from here.
      disclaimer: 'AI-drafted suggestion. Karigari does not send this message — copy it and send it yourself.',
    });
  } catch (error) {
    if (error instanceof GroqError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Creator outreach error:', error);
    return NextResponse.json({ error: 'Could not draft an outreach message.' }, { status: 500 });
  }
}
