import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/prisma';
import crypto from 'crypto';
import { logCraftItemEvent } from '@/lib/auditLogger';
import { validateArtisanClaim } from '@/lib/benchmarkData';
import { estimateCraftValuation, getPricingDiscrepancy } from '@/lib/pricing';

export async function POST(req: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth-token');

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let decoded: any;
    try {
      decoded = jwt.verify(token.value, process.env.JWT_SECRET || 'fallback-secret');
    } catch (e) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    if (decoded.role !== 'ARTISAN') {
      return NextResponse.json({ error: 'Forbidden. Artisan access required.' }, { status: 403 });
    }

    const body = await req.json();
    const { craftType, rawMaterialCost, laborDays, descriptionOriginal, descriptionEnglish, tags, assignedAdminId, images, aiGeneratedListing, askingPrice } = body;
    
    console.log(`[Capture API] Received payload with ${images ? images.length : 'NO'} images.`);
    if (images && images.length > 0) {
      console.log(`[Capture API] First image length: ${images[0].length}`);
    }

    if (!craftType || rawMaterialCost === undefined || laborDays === undefined) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const rawCost = Number(rawMaterialCost);
    const days = Number(laborDays);

    // --- AI AUTO-REJECTION FILTER ---
    const validationResult = validateArtisanClaim(craftType, days, rawCost);
    if (!validationResult.isValid) {
      return NextResponse.json({ error: validationResult.reason }, { status: 400 });
    }

    // --- ML Prediction Engine (Mock) ---
    // Shared with the artisan's price-setting UI (`estimateCraftValuation`), so
    // the band they were quoted in Capture Step 3 is the band we persist here.
    const { fairWageFloor, standardMarketPrice, marketPriceMin, marketPriceMax } =
      estimateCraftValuation(craftType, days, rawCost);
    const creditScore = 85.5; // Mock credit score based on history

    // --- Artisan's own listing price ---
    // They choose what to sell for. Blank falls back to the AI market price so
    // an item is never listed without a price, but it is never silently their
    // "choice" either — a real choice is whatever number they typed.
    const requestedPrice = Number(askingPrice);
    const artisanSetPrice = Number.isFinite(requestedPrice) && requestedPrice > 0 ? requestedPrice : null;
    const resolvedAskingPrice = artisanSetPrice ?? standardMarketPrice;

    // Anti-exploitation guardian, both ways. An artisan pricing themselves far
    // under their own fair wage floor is the artisan-facing half of the
    // middleman squeeze; one pricing far over the AI market band will either
    // never sell or will burn the buyer. Both go to a facilitator, and the rule
    // itself lives in `getPricingDiscrepancy` so capture, the IVR draft, the
    // sale simulator and the queue can never drift apart.
    // Only a price the artisan actually typed is tested: the AI's own market
    // price falling back in is not a decision anyone should be flagged for.
    const priceVerdict = getPricingDiscrepancy({
      fairWageFloor,
      marketPriceMax,
      standardMarketPrice,
      askingPrice: artisanSetPrice,
    });
    const flagged = artisanSetPrice !== null && priceVerdict.flagged;
    const flagReason = flagged ? priceVerdict.reason : null;
    
    // Auto-update ArtisanProfile tags with the new craftType
    try {
      if (craftType) {
        const profile = await prisma.artisanProfile.findUnique({ where: { userId: decoded.userId } });
        if (profile) {
          const currentTags = profile.tags || [];
          if (!currentTags.includes(craftType)) {
            await prisma.artisanProfile.update({
              where: { userId: decoded.userId },
              data: { tags: { push: craftType } }
            });
          }
        } else {
          // Create the profile with the tag if it doesn't exist
          await prisma.artisanProfile.create({
            data: {
              userId: decoded.userId,
              craftType: "Unknown",
              location: "Unknown",
              experienceYears: 0,
              tags: ["Artisan", craftType]
            }
          });
        }
      }
    } catch (tagErr) {
      console.error("Failed to update artisan profile tags:", tagErr);
    }

    const item = await prisma.craftItem.create({
      data: {
        artisanId: decoded.userId,
        assignedAdminId: assignedAdminId || null,
        patchId: null, // Generated during the Sell phase
        craftType,
        descriptionOriginal,
        descriptionEnglish,
        aiGeneratedListing,
        tags: tags || [],
        images: images || [],
        rawMaterialCost: rawCost,
        laborDays: days,
        fairWageFloor,
        standardMarketPrice,
        marketPriceMin,
        marketPriceMax,
        askingPrice: resolvedAskingPrice,
        creditScore,
        fairnessScore: 95.0,
        pricingFlag: flagged,
        flagReason,
        status: 'PENDING_VERIFICATION',
      }
    });

    await logCraftItemEvent({
      prisma,
      craftItemId: item.id,
      actorId: decoded.userId,
      actorRole: 'ARTISAN',
      action: 'UPLOAD_CREATED',
      newState: { status: 'PENDING_VERIFICATION' },
      comments: `Artisan uploaded ${craftType}. Auto-verified math plausible. Sent to Admin for review.`
    });

    if (flagged) {
      await logCraftItemEvent({
        prisma,
        craftItemId: item.id,
        actorId: decoded.userId,
        actorRole: 'SYSTEM',
        action: 'PRICING_FLAG_RAISED',
        newState: { pricingFlag: true, askingPrice: artisanSetPrice, fairWageFloor },
        comments: `${flagReason}. Held for facilitator review under the anti-exploitation policy.`
      });
    }

    return NextResponse.json({ 
      success: true, 
      item, 
      valuations: {
        fairWageFloor,
        marketPriceMin,
        marketPriceMax,
        creditScore,
      }
    });
  } catch (error: any) {
    console.error('Capture API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
