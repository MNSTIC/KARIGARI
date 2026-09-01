import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/prisma';
import { normalizeGender } from '@/lib/gender';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { name, email, password, role, craftType, location, experienceYears, aadhaarLast4, annualIncome, clusterName, gender, photoUrl } = body;

    // Validation
    if (!name || !email || !password || !role) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    const normalizedEmail = email.toLowerCase().trim();
    if (role === 'ARTISAN' && (!aadhaarLast4 || !annualIncome)) {
      return NextResponse.json({ error: 'Aadhaar Last 4 and Annual Income are required for artisans' }, { status: 400 });
    }

    // Required from here on: without it the app cannot tell an artisan whether
    // they qualify for the women-only Womaniya sub-target on GeM.
    const normalizedGender = normalizeGender(gender);
    if (role === 'ARTISAN' && !normalizedGender) {
      return NextResponse.json(
        { error: 'Please select a gender. It is used to check women-only scheme eligibility.' },
        { status: 400 }
      );
    }

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
        role,
        ...(role === 'ARTISAN' && {
          artisanProfile: {
            create: {
              craftType: craftType || 'Unspecified',
              location: location || 'Unspecified',
              experienceYears: Number(experienceYears) || 0,
              aadhaarLast4: aadhaarLast4,
              annualIncome: Number(annualIncome) || 0,
              clusterName: clusterName || 'Independent',
              gender: normalizedGender,
              // Optional at signup. Left null when they skip it, so <Avatar />
              // draws their initials rather than a stock stranger's face.
              photoUrl: typeof photoUrl === 'string' && photoUrl.startsWith('data:image/')
                ? photoUrl
                : null,
            }
          }
        })
      }
    });

    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET || 'fallback-secret',
      { expiresIn: '7d' }
    );

    const cookieStore = await cookies();
    cookieStore.set('auth-token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 // 7 days
    });

    return NextResponse.json({ success: true, user: { id: user.id, name: user.name, role: user.role } });
  } catch (error: any) {
    console.error('Registration error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
