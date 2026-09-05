import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/prisma';

/** Reads the auth cookie, so it must never be statically optimised. */
export const dynamic = 'force-dynamic';


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

    if (decoded.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden. Admin access required.' }, { status: 403 });
    }

    const { artisanId } = await req.json();

    if (!artisanId) {
      return NextResponse.json({ error: 'Missing artisanId' }, { status: 400 });
    }

    const artisan = await prisma.user.findUnique({
      where: { id: artisanId },
      include: { artisanProfile: true }
    });

    if (!artisan || artisan.role !== 'ARTISAN') {
      return NextResponse.json({ error: 'Invalid artisan' }, { status: 400 });
    }

    if ((artisan.artisanProfile?.healthScore || 100) >= 65) {
      return NextResponse.json({ error: 'Artisan health score is above threshold. Cannot ban.' }, { status: 400 });
    }

    // Ban the user
    await prisma.user.update({
      where: { id: artisanId },
      data: { accountStatus: 'BANNED' }
    });

    return NextResponse.json({ success: true, message: 'Artisan has been permanently banned.' });
  } catch (error: any) {
    console.error('Ban error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
