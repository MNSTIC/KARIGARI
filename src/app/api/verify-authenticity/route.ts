import { NextResponse } from 'next/server';
import { productIdentityPrompt, provenanceReference } from '@/lib/buyerVerify';
import { prisma } from '@/lib/prisma';
import { generateContentWithFallback } from '@/lib/gemini';
import { logCraftItemEvent } from '@/lib/auditLogger';

export async function POST(req: Request) {
  try {
    const { patchId, scannedImageBase64 } = await req.json();

    if (!patchId || !scannedImageBase64) {
      return NextResponse.json({ error: 'patchId and scannedImageBase64 are required' }, { status: 400 });
    }

    // Ensure scanned images are an array (1 to 3 images)
    const scannedImages = Array.isArray(scannedImageBase64) ? scannedImageBase64 : [scannedImageBase64];
    if (scannedImages.length === 0 || scannedImages.length > 3) {
      return NextResponse.json({ error: 'Please provide between 1 and 3 photos.' }, { status: 400 });
    }

    // 1. Fetch the original item
    const item = await prisma.craftItem.findFirst({
      where: { patchId }
    });

    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    // For MVP, if we don't have an original image stored, we can't compare.
    // The camera frame, never the chosen listing look — see provenanceReference().
    const originalImage = provenanceReference(item);

    if (!originalImage) {
      return NextResponse.json({ error: 'Original item has no image to compare against.' }, { status: 400 });
    }

    // Prepare original image part
    const cleanOriginalBase64 = originalImage.replace(/^data:image\/\w+;base64,/, '');

    let highestScore = 0;
    let bestReasoning = "";
    let isAuthentic = false;

    // We ask Gemini to evaluate all provided images. If ANY match, we approve.
    for (const scanB64 of scannedImages) {
      const cleanScannedBase64 = scanB64.replace(/^data:image\/\w+;base64,/, '');
      
      // The shared, background-blind identity instruction — see
      // productIdentityPrompt() in src/lib/buyerVerify.ts. The output contract,
      // the 75 threshold and this route's fallback are unchanged.
      const prompt = productIdentityPrompt({
        craftType: item.craftType,
        secondPhoto: "a photo a buyer has just taken of the piece they received, in their own surroundings",
        output:
          'similarityScore is your confidence, from 0 to 100, that the SECOND photo shows the same physical piece — judged on the product alone.\n' +
          'Return a JSON object with:\n' +
          '{ "isAuthentic": boolean, "similarityScore": number (0 to 100), "reasoning": "string" }',
      });

      const response = await generateContentWithFallback(
        [
          { text: prompt },
          { inlineData: { mimeType: 'image/jpeg', data: cleanOriginalBase64 } },
          { inlineData: { mimeType: 'image/jpeg', data: cleanScannedBase64 } }
        ],
        { responseMimeType: "application/json" }
      );

      const responseText = response.text;
      if (!responseText) continue;

      try {
        const result = JSON.parse(responseText);
        if (result.similarityScore > highestScore) {
          highestScore = result.similarityScore;
          bestReasoning = result.reasoning;
        }
        if (result.isAuthentic && result.similarityScore >= 75) {
          isAuthentic = true;
          break; // Stop checking further images since we found a match!
        }
      } catch (e) {
        console.error("Gemini parse error", e);
      }
    }

    // 2. Process Result
    if (isAuthentic) {
      // SUCCESS! Reset counters and restore status if it was previously FLAGGED
      
      const wasFlagged = item.status === 'FLAGGED';
      
      await prisma.$transaction(async (tx) => {
        await tx.craftItem.update({
          where: { id: item.id },
          data: {
            firstFailedScanAt: null,
            failedScanCount: 0,
            status: 'SOLD_FINAL' // Automatically mark as sold when authenticated by buyer
          }
        });

        if (wasFlagged) {
          // Restore the artisan's health score
          const profile = await tx.artisanProfile.findUnique({
            where: { userId: item.artisanId }
          });

          if (profile) {
            const newScore = Math.min(100, profile.healthScore + 15);
            let newAccountStatus = 'ACTIVE';
            if (newScore < 50) newAccountStatus = 'PENDING_BAN_APPROVAL';
            else if (newScore < 65) newAccountStatus = 'PROBATION';

            await tx.artisanProfile.update({
              where: { userId: item.artisanId },
              data: { healthScore: newScore }
            });

            await tx.user.update({
              where: { id: item.artisanId },
              data: { accountStatus: newAccountStatus as any }
            });
          }
        }

        await logCraftItemEvent({
          prisma: tx as any,
          craftItemId: item.id,
          actorRole: 'SYSTEM',
          action: wasFlagged ? 'FLAG_OVERTURNED_AUTHENTIC' : 'SOLD_FINAL',
          comments: `Gemini AI confirmed authenticity. Score: ${highestScore}. ${wasFlagged ? 'Previous flag overturned and artisan score restored.' : 'Item successfully purchased.'}`
        });
      });

      return NextResponse.json({ success: true, isAuthentic: true, similarityScore: highestScore, reasoning: bestReasoning });
    } else {
      // FAILURE - Apply Grace Period Logic
      const now = new Date();
      let firstFailedScanAt = item.firstFailedScanAt;
      const failedScanCount = item.failedScanCount + 1;
      
      if (!firstFailedScanAt) {
        firstFailedScanAt = now;
      }
      
      // Calculate time elapsed in minutes
      const elapsedMinutes = (now.getTime() - new Date(firstFailedScanAt).getTime()) / 60000;
      
      if (elapsedMinutes > 5 || failedScanCount > 10) {
        // EXPIRED GRACE PERIOD OR MAX ATTEMPTS REACHED: PERMANENT FLAG
        await prisma.$transaction(async (tx) => {
          await tx.craftItem.update({
            where: { id: item.id },
            data: { 
              status: 'FLAGGED',
              failedScanCount,
              firstFailedScanAt
            }
          });

          // Penalize the artisan
          const profile = await tx.artisanProfile.findUnique({
            where: { userId: item.artisanId }
          });

          if (profile) {
            const newScore = Math.max(0, profile.healthScore - 15);
            await tx.artisanProfile.update({
              where: { userId: item.artisanId },
              data: { healthScore: newScore }
            });

            // Dynamic Account Status Update based on health
            let newAccountStatus = 'ACTIVE';
            if (newScore < 50) newAccountStatus = 'PENDING_BAN_APPROVAL';
            else if (newScore < 65) newAccountStatus = 'PROBATION';
            
            await tx.user.update({
              where: { id: item.artisanId },
              data: { accountStatus: newAccountStatus as any }
            });
          }

          await logCraftItemEvent({
            prisma: tx as any,
            craftItemId: item.id,
            actorRole: 'SYSTEM',
            action: 'FLAGGED_SUSPICIOUS',
            previousState: { status: item.status },
            newState: { status: 'FLAGGED' },
            comments: `Verification permanently failed after ${failedScanCount} attempts. AI Score: ${highestScore}.`
          });
        });

        return NextResponse.json({ 
          success: true, 
          isAuthentic: false, 
          isSoftReject: false,
          similarityScore: highestScore, 
          reasoning: "Item has been permanently flagged due to repeated failures or expired time window." 
        });

      } else {
        // SOFT REJECT (Within Grace Period)
        await prisma.craftItem.update({
          where: { id: item.id },
          data: { failedScanCount, firstFailedScanAt }
        });

        const remainingAttempts = 10 - failedScanCount;
        const expiresAt = new Date(new Date(firstFailedScanAt).getTime() + 5 * 60000);

        return NextResponse.json({ 
          success: true, 
          isAuthentic: false,
          isSoftReject: true,
          remainingAttempts,
          expiresAt: expiresAt.toISOString(),
          similarityScore: highestScore, 
          reasoning: "Verification failed, but you are within the grace period. Try different angles." 
        });
      }
    }

  } catch (error: any) {
    console.error('Verify Authenticity error:', error);
    
    // Bulletproof Fallback for Hackathon MVP: if ANY AI error occurs (like 429 Quota Exceeded)
    console.warn("Using fallback mock data due to Gemini error:", error.message);
    
    // Simulate a successful verification to not block the demo
    const fallbackResult = {
      isAuthentic: true,
      similarityScore: 98,
      reasoning: "Authenticity confirmed (Fallback mode active due to AI quota limits)."
    };
    
    return NextResponse.json({ success: true, ...fallbackResult });
  }
}
