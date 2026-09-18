import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { toPublicMotif } from '@/lib/motifLicence';

/**
 * GET /api/motif/registry?cluster=&q=&page= — the public motif register.
 *
 * No session, no AI key and no payment configuration are needed to read this.
 *
 * Every row goes out through `toPublicMotif`, which builds the response field by
 * field from an allow-list: the submitting artisan's name is carried for credit,
 * and their id, mobile number, UPI id and email are absent because they were
 * never selected, not because something remembered to strip them. The cluster
 * appears under its readable name, never its raw `auto:<location>` key.
 *
 * Only REGISTERED rows are public. A PENDING filing is not yet a record, and a
 * FLAGGED_DUPLICATE one is a question for a reviewer — publishing either would
 * put an unreviewed claim on the open web.
 */
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 12;
const MAX_QUERY = 60;

export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    const cluster = (params.get('cluster') ?? '').trim().slice(0, 120);
    const q = (params.get('q') ?? '').trim().slice(0, MAX_QUERY);
    const page = Math.max(0, Number(params.get('page') ?? 0) || 0);

    const where = {
      status: 'REGISTERED',
      ...(cluster ? { clusterKey: cluster } : {}),
      ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.motifRegistration.findMany({
        where,
        orderBy: { registeredAt: 'desc' },
        skip: page * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true,
          name: true,
          hash: true,
          clusterKey: true,
          descriptors: true,
          referenceImageUrl: true,
          status: true,
          licensable: true,
          registeredAt: true,
          submittedBy: { select: { name: true } },
        },
      }),
      prisma.motifRegistration.count({ where }),
    ]);

    return NextResponse.json({
      success: true,
      motifs: rows.map(toPublicMotif),
      page,
      pageSize: PAGE_SIZE,
      total,
      hasMore: (page + 1) * PAGE_SIZE < total,
    });
  } catch (error) {
    console.error('[motif/registry] failed:', error);
    return NextResponse.json({ success: false, error: 'Could not load the register.' }, { status: 500 });
  }
}
