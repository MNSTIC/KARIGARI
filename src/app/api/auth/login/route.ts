import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { issueSession } from '@/lib/authSession';

/** Reads the auth cookie, so it must never be statically optimised. */
export const dynamic = 'force-dynamic';


export async function POST(req: Request) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'Missing email or password' }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // There is exactly one admin role. The demo admin (superadmin@karigari.com)
    // is a normal seeded ADMIN row and authenticates through the same path as
    // everyone else — the token payload is always just { userId, role }.
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    // A Google or passkey account has no password to compare against. bcryptjs
    // THROWS on a null hash, and a caught throw that fell through to "valid"
    // would be a total authentication bypass — so this is checked before the
    // call, not around it.
    //
    // The response is the same generic 401 an unknown email and a wrong password
    // both get. Saying "this account uses Google" would confirm the address
    // exists and name its provider to anyone who asked, which is an account
    // enumeration leak. The real reason is logged server-side instead.
    if (!user.passwordHash) {
      console.warn(
        `[auth/login] password attempt on a ${user.authProvider} account: ${user.id}`
      );
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    await issueSession(user);

    return NextResponse.json({ success: true, user: { id: user.id, name: user.name, role: user.role } });
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
