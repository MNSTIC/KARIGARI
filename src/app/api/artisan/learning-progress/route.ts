import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireArtisan } from '@/lib/artisanAuth';
import { isModuleKey } from '@/lib/learningPlan';
import {
  gatherStageRecord,
  LEARNING_STATUS_COMPLETED,
  LEARNING_STATUS_STARTED,
} from '@/lib/skillStageRecord';

/**
 * POST /api/artisan/learning-progress
 * Body: { moduleKey: "business:pricing-basics", action: "start" | "complete" | "undo" }
 *
 * The only writer of LearningProgress.
 *
 *   start    — the artisan opened the YouTube search. Creates a STARTED row if
 *              there is none; never touches an existing row, so it cannot undo
 *              a COMPLETED one.
 *   complete — "Mark as done". Upsert to COMPLETED; doing it twice, or from two
 *              tabs at once, leaves one row (`@@unique([artisanId, moduleKey])`).
 *   undo     — "Done" tapped again. COMPLETED goes back to STARTED; the row is
 *              kept.
 *
 * Returns the recomputed stage, because three completed lessons is one of the
 * PRO criteria and the page shows the new have/need straight away.
 */
export const dynamic = 'force-dynamic';

const ACTIONS = new Set(['start', 'complete', 'undo']);

/**
 * Two tabs creating the same row at the same instant can both miss it and both
 * insert; the unique index rejects the second with P2002. That row now exists,
 * so running the same write once more is correct, not a failure.
 */
async function retryOnUniqueRace<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if ((error as { code?: string })?.code !== 'P2002') throw error;
    return write();
  }
}

/** A ceiling on rows per artisan, so a script cannot fill the table. */
const MAX_PROGRESS_ROWS = 300;

export async function POST(req: Request) {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;
  const artisanId = auth.artisan.userId;

  const body = await req.json().catch(() => null);
  const moduleKey = body?.moduleKey;
  const action = body?.action;
  if (!isModuleKey(moduleKey) || typeof action !== 'string' || !ACTIONS.has(action)) {
    return NextResponse.json(
      { success: false, code: 'BAD_REQUEST', error: 'moduleKey (track:slug) and action (start | complete | undo) are required.' },
      { status: 400 }
    );
  }

  try {
    const where = { artisanId_moduleKey: { artisanId, moduleKey } };
    const existing = await prisma.learningProgress.findUnique({ where, select: { status: true } });

    if (!existing && action !== 'undo') {
      const rows = await prisma.learningProgress.count({ where: { artisanId } });
      if (rows >= MAX_PROGRESS_ROWS) {
        return NextResponse.json(
          { success: false, code: 'LIMIT', error: 'Too many learning records.' },
          { status: 409 }
        );
      }
    }

    let status: string | null = existing?.status ?? null;
    if (action === 'start') {
      if (!existing) {
        const row = await retryOnUniqueRace(() =>
          prisma.learningProgress.upsert({
            where,
            create: { artisanId, moduleKey, status: LEARNING_STATUS_STARTED },
            // A concurrent create won; leave whatever it wrote.
            update: {},
            select: { status: true },
          })
        );
        status = row.status;
      }
    } else if (action === 'complete') {
      const row = await retryOnUniqueRace(() =>
        prisma.learningProgress.upsert({
          where,
          create: { artisanId, moduleKey, status: LEARNING_STATUS_COMPLETED },
          update: { status: LEARNING_STATUS_COMPLETED },
          select: { status: true },
        })
      );
      status = row.status;
    } else if (existing?.status === LEARNING_STATUS_COMPLETED) {
      const updated = await prisma.learningProgress.updateMany({
        where: { artisanId, moduleKey, status: LEARNING_STATUS_COMPLETED },
        data: { status: LEARNING_STATUS_STARTED },
      });
      status = updated.count > 0 ? LEARNING_STATUS_STARTED : status;
    }

    const record = await gatherStageRecord(artisanId);
    return NextResponse.json({
      success: true,
      moduleKey,
      status,
      stage: record.result,
      inputs: record.inputs,
      earnings: record.earnings,
    });
  } catch (error) {
    console.error('[learning-progress] failed:', error);
    return NextResponse.json({ success: false, error: 'Could not save that right now.' }, { status: 500 });
  }
}
