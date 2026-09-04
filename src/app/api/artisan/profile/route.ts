import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { GENDERS, normalizeGender } from '@/lib/gender';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';

/** The only social categories the eligibility engine (src/lib/schemes.ts) understands. */
const SOCIAL_CATEGORIES = ['SC', 'ST', 'OBC', 'EWS', 'GENERAL'] as const;
type SocialCategory = (typeof SOCIAL_CATEGORIES)[number];

/**
 * `undefined` → field omitted from the request, leave whatever is stored alone.
 * `null`      → explicitly cleared.
 * Anything else that is not a known category is a 400, so the column can never
 * hold a value the scheme rules cannot read.
 */
function parseSocialCategory(
  value: unknown
): { ok: true; value: SocialCategory | null } | { ok: false; error: string } {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== 'string') {
    return { ok: false, error: 'socialCategory must be null or one of SC, ST, OBC, EWS, GENERAL' };
  }
  const normalized = value.trim().toUpperCase();
  if (!(SOCIAL_CATEGORIES as readonly string[]).includes(normalized)) {
    return { ok: false, error: 'socialCategory must be null or one of SC, ST, OBC, EWS, GENERAL' };
  }
  return { ok: true, value: normalized as SocialCategory };
}

/**
 * The demand map pins an artisan by this string, so an empty one is worse than
 * no update at all: it silently removes their pin. Blank is therefore rejected
 * rather than written, and the column is left untouched when the key is absent.
 */
function parseLocation(
  value: unknown
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return { ok: false, error: 'location must be a non-empty town or city name' };
  }
  return { ok: true, value: value.trim().slice(0, 120) };
}

function parseAnnualIncome(
  value: unknown
): { ok: true; value: number | null } | { ok: false; error: string } {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return { ok: false, error: 'annualIncome must be null or a number greater than or equal to 0' };
  }
  return { ok: true, value };
}

/**
 * Snapshot of the acting artisan's profile — read by the market page so it can
 * filter B2B demands to the ones matching this artisan's craft, rather than
 * showing the whole board unfiltered. Deliberately narrow: only the fields a
 * page needs for filtering / banners are returned.
 */
export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth-token');
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let decoded: { userId: string; role: string };
    try {
      decoded = jwt.verify(token.value, process.env.JWT_SECRET || 'fallback-secret') as {
        userId: string;
        role: string;
      };
    } catch {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }
    if (decoded.role !== 'ARTISAN') {
      return NextResponse.json({ error: 'Artisan role required' }, { status: 403 });
    }

    const profile = await prisma.artisanProfile.findUnique({
      where: { userId: decoded.userId },
      select: {
        craftType: true,
        location: true,
        clusterName: true,
        tags: true,
        experienceYears: true,
      },
    });

    // Absent profile is a common early state (freshly onboarded artisan) —
    // return a nulled shape rather than 404 so the client can render its
    // "complete your profile" banner without special-casing status codes.
    if (!profile) {
      return NextResponse.json({
        success: true,
        profile: {
          craftType: null,
          location: null,
          clusterName: null,
          tags: [] as string[],
          experienceYears: null,
        },
      });
    }

    return NextResponse.json({ success: true, profile });
  } catch (error) {
    console.error('Artisan profile GET error:', error);
    return NextResponse.json({ error: 'Failed to load profile' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth-token');

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let decoded: { userId: string; role: string };
    try {
      decoded = jwt.verify(token.value, process.env.JWT_SECRET || 'fallback-secret') as {
        userId: string;
        role: string;
      };
    } catch {
      // An expired or tampered token is an auth failure, not a server fault —
      // and the raw jwt error must not be echoed back to the caller.
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    if (decoded.role !== 'ARTISAN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }
    const userId = decoded.userId;

    const body = await req.json();
    const { name, photoUrl, upiId, description, mobileNumber, aadhaarLast4 } = body;

    // Left `undefined` when the key is absent, so Prisma skips the column and an
    // unrelated profile save can never wipe an artisan's recorded category/income.
    let socialCategory: SocialCategory | null | undefined;
    if (Object.prototype.hasOwnProperty.call(body ?? {}, 'socialCategory')) {
      const parsed = parseSocialCategory(body.socialCategory);
      if (!parsed.ok) {
        return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });
      }
      socialCategory = parsed.value;
    }

    // Same absent-vs-null discipline as socialCategory: a partial save must not
    // silently erase a gender the artisan already recorded.
    let gender: string | null | undefined;
    if (Object.prototype.hasOwnProperty.call(body ?? {}, 'gender')) {
      const raw = body.gender;
      if (raw === null || raw === '') {
        gender = null;
      } else {
        const parsed = normalizeGender(raw);
        if (!parsed) {
          return NextResponse.json(
            { success: false, error: `gender must be null or one of ${GENDERS.join(', ')}` },
            { status: 400 }
          );
        }
        gender = parsed;
      }
    }

    let location: string | undefined;
    if (Object.prototype.hasOwnProperty.call(body ?? {}, 'location')) {
      const parsed = parseLocation(body.location);
      if (!parsed.ok) {
        return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });
      }
      location = parsed.value;
    }

    let annualIncome: number | null | undefined;
    if (Object.prototype.hasOwnProperty.call(body ?? {}, 'annualIncome')) {
      const parsed = parseAnnualIncome(body.annualIncome);
      if (!parsed.ok) {
        return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });
      }
      annualIncome = parsed.value;
    }

    // Update User model
    if (name) {
      await prisma.user.update({
        where: { id: userId },
        data: { name }
      });
    }

    // Update ArtisanProfile
    const profile = await prisma.artisanProfile.upsert({
      where: { userId },
      update: {
        photoUrl,
        upiId,
        description,
        mobileNumber,
        aadhaarLast4,
        socialCategory,
        gender,
        annualIncome,
        location
      },
      create: {
        userId,
        craftType: 'Unknown',
        // 'Unknown' is unresolvable on purpose: the insights page then shows the
        // "complete your profile" banner instead of dropping a guessed pin.
        location: location ?? 'Unknown',
        experienceYears: 0,
        photoUrl,
        upiId,
        description,
        mobileNumber,
        aadhaarLast4,
        socialCategory,
        gender,
        annualIncome
      }
    });

    return NextResponse.json({ success: true, data: profile });
  } catch (error) {
    console.error("Profile update error:", error);
    return NextResponse.json({ success: false, error: 'Failed to save profile' }, { status: 500 });
  }
}
