import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { cookies } from 'next/headers';
import { verifyJwt } from '@/lib/jwt';

export async function GET(req: Request) {
  try {
    const token = cookies().get('auth_token')?.value;
    let userId = null;
    
    if (token) {
      try {
        const payload = verifyJwt(token);
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
            clusterName: true,
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return NextResponse.json({ success: true, items, currentUserId: userId });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
