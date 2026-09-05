import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

/** Reads the auth cookie, so it must never be statically optimised. */
export const dynamic = 'force-dynamic';


export async function POST(req: Request) {
  const cookieStore = await cookies();
  cookieStore.delete('auth-token');
  return NextResponse.json({ success: true });
}
