import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getListingPrice } from '@/lib/pricing';
import crypto from 'crypto';

export async function GET(req: Request, { params }: { params: Promise<{ patchId: string }> }) {
  try {
    const { patchId } = await params;

    if (!patchId) {
      return NextResponse.json({ error: 'Missing patchId' }, { status: 400 });
    }

    const item = await prisma.craftItem.findFirst({
      where: { patchId },
      include: {
        artisan: {
          include: {
            artisanProfile: true
          }
        }
      }
    });

    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    // Generate the same passportHash that we would during capture
    const passportHash = crypto.createHash('sha256').update(`${patchId}-${item.fairWageFloor}`).digest('hex');

    // Structure public provenance data
    const publicData = {
      craftType: item.craftType,
      tags: item.tags,
      description: item.descriptionEnglish || item.descriptionOriginal,
      materials: item.tags.join(", "), // Fallback if explicit materials list isn't present
      timeToMake: `${item.laborDays} Days`,
      fairWageFloor: item.fairWageFloor,
      // What the item is actually offered at — the artisan's own price.
      listingPrice: item.salePrice ?? getListingPrice(item),
      status: item.status,
      dateVerified: item.createdAt,
      passportHash,
      artisan: {
        name: item.artisan.name,
        cooperative: item.artisan.artisanProfile?.cooperativeId || 'KARIGARI Network',
        location: item.artisan.artisanProfile?.location,
      }
    };

    return NextResponse.json({ success: true, item: publicData });
  } catch (error: any) {
    console.error('Verify API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
