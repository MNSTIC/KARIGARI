import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/prisma';

/**
 * Just the two strings the AI surfaces need to ask their question.
 *
 * Raw Materials, Live News and Insights each used to call
 * `GET /api/artisan/dashboard` purely to read `craftType` and `clusterName`,
 * then make their real request — two round trips, the first of them the
 * heaviest endpoint in the app. This is one indexed lookup returning a few
 * dozen bytes.
 */
export const dynamic = 'force-dynamic';

type AuthToken = { userId: string; role: string };

export async function GET() {
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

    const profile = await prisma.artisanProfile.findUnique({
      where: { userId: decoded.userId },
      select: { craftType: true, clusterName: true },
    });

    return NextResponse.json({
      success: true,
      craftType: profile?.craftType || 'General Crafts',
      clusterName: profile?.clusterName || 'Local Artisan Cluster',
    });
  } catch (error) {
    console.error('Profile-lite error:', error);
    return NextResponse.json({ error: 'Failed to load profile' }, { status: 500 });
  }
}
