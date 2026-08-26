import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/prisma';
import { logCraftItemEvent } from '@/lib/auditLogger';
import { validateArtisanClaim } from '@/lib/benchmarkData';

export const dynamic = 'force-dynamic';

/** The whole JWT payload: one admin role, nothing else. */
type AuthToken = { userId: string; role: string };

/**
 * Assisted Onboarding (new_admin.md Tier 1.3).
 *
 * A facilitator catalogues on behalf of an artisan who has no smartphone: the
 * facilitator holds the device, the artisan speaks, and the listing is published
 * under the artisan's own profile. Identical valuation maths to
 * `/api/items/capture` so an assisted item is priced exactly like a self-served one.
 */
export async function POST(req: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth-token');

    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let decoded: AuthToken;
    try {
      decoded = jwt.verify(token.value, process.env.JWT_SECRET || 'fallback-secret') as AuthToken;
    } catch {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    if (decoded.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden. Admin access required.' }, { status: 403 });
    }

    const body = await req.json();
    const {
      artisanId,
      craftType,
      rawMaterialCost,
      laborDays,
      descriptionOriginal,
      descriptionEnglish,
      aiGeneratedListing,
      tags,
      images,
      catalogMethod,
      voiceLanguage,
      audioUrl,
    } = body;

    if (!artisanId) {
      return NextResponse.json({ error: 'artisanId is required' }, { status: 400 });
    }
    if (!craftType || rawMaterialCost === undefined || laborDays === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields: craftType, rawMaterialCost, laborDays' },
        { status: 400 }
      );
    }

    const artisan = await prisma.user.findUnique({
      where: { id: artisanId },
      include: { artisanProfile: true },
    });
    if (!artisan || artisan.role !== 'ARTISAN') {
      return NextResponse.json({ error: 'Artisan not found' }, { status: 404 });
    }

    const rawCost = Number(rawMaterialCost);
    const days = Number(laborDays);
    if (!Number.isFinite(rawCost) || !Number.isFinite(days) || rawCost < 0 || days <= 0) {
      return NextResponse.json(
        { error: 'rawMaterialCost and laborDays must be positive numbers' },
        { status: 400 }
      );
    }

    // Same auto-rejection filter the artisan flow runs.
    const validation = validateArtisanClaim(craftType, days, rawCost);
    if (!validation.isValid) {
      return NextResponse.json({ error: validation.reason }, { status: 400 });
    }

    // --- Fair wage engine (mirrors /api/items/capture) ---
    let baseWage = 500;
    const craftLower = String(craftType).toLowerCase();
    if (craftLower.includes('silk')) baseWage = 650;
    else if (craftLower.includes('cotton')) baseWage = 450;
    else if (craftLower.includes('wool')) baseWage = 550;

    const laborCost = days * baseWage;
    const overhead = (laborCost + rawCost) * 0.1;
    const fairWageFloor = laborCost + rawCost + overhead;

    const currentMonth = new Date().getMonth();
    const seasonalBump = (currentMonth === 9 || currentMonth === 10) && craftLower.includes('silk') ? 1.15 : 1.0;

    const standardMarketPrice = fairWageFloor * 1.4 * seasonalBump;
    const marketPriceMin = fairWageFloor * 1.2 * seasonalBump;
    const marketPriceMax = fairWageFloor * 1.6 * seasonalBump;

    const method = catalogMethod === 'MANUAL' ? 'MANUAL' : 'VOICE';
    const language = voiceLanguage || (method === 'MANUAL' ? 'English' : 'Unknown');

    const item = await prisma.craftItem.create({
      data: {
        artisanId,
        assignedAdminId: decoded.userId,
        patchId: null,
        craftType,
        descriptionOriginal: descriptionOriginal || null,
        descriptionEnglish: descriptionEnglish || null,
        aiGeneratedListing: aiGeneratedListing || null,
        aiSuggestedCategory: Array.isArray(tags) && tags.length > 0 ? tags[0] : null,
        tags: Array.isArray(tags) ? tags : [],
        images: Array.isArray(images) ? images : [],
        rawMaterialCost: rawCost,
        laborDays: days,
        fairWageFloor,
        standardMarketPrice,
        marketPriceMin,
        marketPriceMax,
        creditScore: 85.5,
        fairnessScore: 95.0,
        status: 'PENDING_VERIFICATION',
        catalogMethod: method,
        voiceLanguage: language,
        audioUrl: audioUrl || null,
      },
    });

    await logCraftItemEvent({
      prisma,
      craftItemId: item.id,
      actorId: decoded.userId,
      actorRole: 'ADMIN',
      action: 'ASSISTED_CATALOG_CREATED',
      newState: { status: 'PENDING_VERIFICATION', catalogMethod: method, voiceLanguage: language },
      comments: `Facilitator catalogued ${craftType} on behalf of ${artisan.name} (assisted onboarding, ${method.toLowerCase()} capture in ${language}). AI fair wage floor: ₹${Math.round(
        fairWageFloor
      ).toLocaleString('en-IN')}.`,
    });

    return NextResponse.json({
      success: true,
      item,
      valuations: { fairWageFloor, marketPriceMin, marketPriceMax, standardMarketPrice },
    });
  } catch (error) {
    console.error('Capture On Behalf API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
