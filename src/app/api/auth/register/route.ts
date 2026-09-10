import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { issueSession } from '@/lib/authSession';
import { validateSignup } from '@/lib/registrationRules';

/** Reads the auth cookie, so it must never be statically optimised. */
export const dynamic = 'force-dynamic';

/**
 * Password sign-up — unchanged in behaviour by V10.
 *
 * What moved: the artisan-field validation now lives in
 * `src/lib/registrationRules.ts` and the session minting in
 * `src/lib/authSession.ts`, because `/api/auth/google/complete` creates accounts
 * too and two copies of these rules would drift the first time one gained a
 * field. Every error string, every default and every cookie flag is what this
 * route already returned.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const validation = validateSignup(body);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const { name, role, artisanProfile } = validation.value;

    const normalizedEmail = String(email).toLowerCase().trim();

    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existingUser) {
      return NextResponse.json({ error: 'User already exists' }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        name,
        email: normalizedEmail,
        passwordHash,
        // Explicit rather than relying on the column default, so a reader of
        // this route can see which of the three providers it creates.
        authProvider: 'PASSWORD',
        role,
        ...(artisanProfile ? { artisanProfile: { create: artisanProfile } } : {}),
      },
    });

    await issueSession(user);

    return NextResponse.json({ success: true, user: { id: user.id, name: user.name, role: user.role } });
  } catch (error) {
    console.error('Registration error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
