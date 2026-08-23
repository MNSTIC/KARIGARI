import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';

export async function GET(req: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth_token')?.value;
    let userId = null;
    
    if (token) {
      try {
        const payload = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret') as any;
        userId = payload.userId;
      } catch (e) {
        // Not fatal, we can still show public listings
      }
    }

    const items = await prisma.craftItem.findMany({
      include: {
        artisan: {
          select: {
            name: true,
            artisanProfile: {
              select: {
                clusterName: true,
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Map it so frontend can just read artisan.clusterName
    const formattedItems = items.map(item => ({
      ...item,
      artisan: {
        name: item.artisan.name,
        clusterName: item.artisan.artisanProfile?.clusterName || 'Artisan Cluster'
      }
    }));

    return NextResponse.json({ success: true, items: formattedItems, currentUserId: userId });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
