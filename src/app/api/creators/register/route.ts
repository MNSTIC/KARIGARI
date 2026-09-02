import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  affiliateUrl,
  isCreatorPlatform,
  looksLikeUpi,
  slugifyHandle,
} from '@/lib/creators';

/**
 * Creator self-registration.
 *
 * Public by design: a local creator has no account in this app and never gets
 * one. They give a handle and their own VPA, and that VPA is the only place
 * their 5% can ever go — there is no admin step between registering and being
 * paid, exactly as with the artisan settlement.
 */
export const dynamic = 'force-dynamic';

function origin(req: Request): string {
  const configured = (
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    ''
  ).trim();
  if (configured) return configured.replace(/\/+$/, '');
  return new URL(req.url).origin;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const rawHandle = typeof body?.handle === 'string' ? body.handle : '';
    const platform = typeof body?.platform === 'string' ? body.platform : 'INSTAGRAM';
    const nicheCategory =
      typeof body?.nicheCategory === 'string' ? body.nicheCategory.trim() : '';
    const upiId = typeof body?.upiId === 'string' ? body.upiId.trim() : '';
    const profileUrl = typeof body?.profileUrl === 'string' ? body.profileUrl.trim() : '';
    const photoUrl = typeof body?.photoUrl === 'string' ? body.photoUrl : '';
    const location = typeof body?.location === 'string' ? body.location.trim() : '';
    const bio = typeof body?.bio === 'string' ? body.bio.trim() : '';

    const handle = slugifyHandle(rawHandle);

    if (!name) {
      return NextResponse.json({ error: 'Your name is required.' }, { status: 400 });
    }
    if (handle.length < 3) {
      return NextResponse.json(
        { error: 'Pick a handle of at least 3 letters or numbers.' },
        { status: 400 }
      );
    }
    if (!nicheCategory) {
      return NextResponse.json({ error: 'Pick the craft you promote.' }, { status: 400 });
    }
    if (!isCreatorPlatform(platform)) {
      return NextResponse.json(
        { error: 'Pick Instagram, YouTube or NIFT student.' },
        { status: 400 }
      );
    }
    if (!looksLikeUpi(upiId)) {
      // The commission is paid direct to this VPA and nowhere else, so a
      // malformed one has to be caught here rather than at settlement.
      return NextResponse.json(
        { error: 'Enter your UPI ID in the form name@bank — this is where your 5% is paid.' },
        { status: 400 }
      );
    }

    const taken = await prisma.creator.findUnique({
      where: { handle },
      select: { id: true },
    });
    if (taken) {
      return NextResponse.json(
        { error: `The handle @${handle} is already registered. Try another one.` },
        { status: 409 }
      );
    }

    const creator = await prisma.creator.create({
      data: {
        name,
        handle,
        platform,
        nicheCategory,
        upiId,
        profileUrl: profileUrl || null,
        photoUrl: photoUrl || null,
        location: location || null,
        bio: bio || null,
      },
      select: { id: true, handle: true, name: true },
    });

    return NextResponse.json({
      success: true,
      creatorId: creator.id,
      handle: creator.handle,
      affiliateUrl: affiliateUrl(origin(req), creator.handle),
      affiliateUrlTemplate: affiliateUrl(origin(req), creator.handle),
    });
  } catch (error) {
    console.error('Creator register error:', error);
    return NextResponse.json({ error: 'Could not register you right now.' }, { status: 500 });
  }
}
