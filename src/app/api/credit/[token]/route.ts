import { NextResponse } from 'next/server';
import { openCreditShare } from '@/lib/creditRecord';

export const dynamic = 'force-dynamic';

/**
 * Public read of one frozen production record — what a loan officer's link
 * opens. No session: the token is the capability.
 *
 * 404 for a token that never existed (or is not even shaped like one), 410 for
 * a link the artisan revoked or that expired. Neither carries any data. The
 * body on success is the allow-listed `PublicCreditRecord` — never contact,
 * bank or identity fields, never a buyer's name.
 */

const HEADERS = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const result = await openCreditShare(token);
    if (result.state === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Not found.' }, { status: 404, headers: HEADERS });
    }
    if (result.state === 'GONE') {
      return NextResponse.json(
        { error: 'This link has been revoked or has expired.' },
        { status: 410, headers: HEADERS }
      );
    }
    return NextResponse.json({ success: true, record: result.record }, { headers: HEADERS });
  } catch (error) {
    console.error('Public credit record error:', error);
    return NextResponse.json({ error: 'Could not open this record.' }, { status: 500, headers: HEADERS });
  }
}
