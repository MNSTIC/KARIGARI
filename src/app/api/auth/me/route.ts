import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';

export async function GET(req: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth-token')?.value;

    if (!token) {
      return NextResponse.json({ error: 'No token' }, { status: 401 });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret') as { userId: string, role: string };
    
    return NextResponse.json({ success: true, userId: decoded.userId, role: decoded.role });
  } catch (error: any) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
  }
}
