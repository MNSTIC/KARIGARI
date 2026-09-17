import { NextResponse } from 'next/server';
import { requireArtisan } from '@/lib/artisanAuth';
import { readSupplyStatus, snoozeSupplyReminder } from '@/lib/supplyReminder';
import { SNOOZE_DAYS } from '@/lib/supplyReminderRules';

/**
 * GET  /api/artisan/supply-reminder  — how long this artisan has been quiet.
 * POST /api/artisan/supply-reminder  — { action: 'snooze' }, "remind me later".
 *
 * The GET is read-only on purpose. The write half runs from the dashboard
 * request (src/lib/supplyReminder.ts); a page asking "am I idle?" must not be
 * able to create an alert as a side effect, or opening this endpoint twice
 * would be how the artisan finds out they are idle.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;

  try {
    const status = await readSupplyStatus(auth.artisan.userId);
    return NextResponse.json({ success: true, ...status }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[supply-reminder] read failed:', error);
    return NextResponse.json({ success: false, error: 'Could not read your activity right now.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  if (body?.action !== 'snooze') {
    return NextResponse.json(
      { success: false, code: 'BAD_REQUEST', error: "action must be 'snooze'." },
      { status: 400 }
    );
  }

  try {
    const until = await snoozeSupplyReminder(auth.artisan.userId);
    return NextResponse.json({ success: true, snoozedUntil: until.toISOString(), days: SNOOZE_DAYS });
  } catch (error) {
    console.error('[supply-reminder] snooze failed:', error);
    return NextResponse.json({ success: false, error: 'Could not save that right now.' }, { status: 500 });
  }
}
