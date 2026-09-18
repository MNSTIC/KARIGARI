import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { saltedIpHash } from '@/lib/searchLog';
import { LICENCE_RATE_LIMIT, LICENCE_RATE_WINDOW_MS } from '@/lib/motifLicence';
import { clusterArtisanIds, licenceEnquiryTitle, notifyCluster } from '@/lib/motifRecord';

/**
 * POST /api/motif/licence — a brand asks a cluster to licence a motif.
 *
 * Public, like the register it reads from: a buyer has no account on this
 * platform, so the enquirer identifies themselves in free text exactly as
 * `Demand.buyerName` already works.
 *
 * Nothing is agreed here. The row lands in REQUESTED and stays there until a
 * human acting for the cluster accepts with a figure or declines — there is no
 * auto-approval and no suggested fee, because a price a village did not name is
 * not a price.
 *
 * Rate-limited on a salted hash of the caller's address, the same digest
 * `MarketplaceSearch` and `AffiliateClick` already store. The only question it
 * answers is "was this the same visitor", which is what a rate limit needs and
 * nothing more.
 */
export const dynamic = 'force-dynamic';

const MAX_NAME = 80;
const MAX_CONTACT = 120;
const MAX_USE = 400;
const MAX_SCOPE = 120;

function text(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  // Filtered by code point rather than by a regex literal: control characters
  // and bidi overrides are invisible in source, and a reader cannot check a
  // rule they cannot see.
  const kept = [...value].filter((ch) => {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 32) return false;
    if (cp >= 127 && cp < 160) return false;
    // Bidi embeddings and overrides, which can make a line read as its reverse.
    if (cp >= 0x202a && cp <= 0x202e) return false;
    if (cp >= 0x2066 && cp <= 0x2069) return false;
    return true;
  });
  return kept.join('').replace(/\s+/g, ' ').trim().slice(0, max);
}

function fail(status: number, code: string, error: string) {
  return NextResponse.json({ success: false, code, error }, { status });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const motifId = typeof body.motifId === 'string' ? body.motifId : '';
    const licenseeName = text(body.licenseeName, MAX_NAME);
    const licenseeContact = text(body.licenseeContact, MAX_CONTACT);
    const intendedUse = text(body.intendedUse, MAX_USE);
    const scope = text(body.scope, MAX_SCOPE);

    if (!motifId || !licenseeName || !licenseeContact || !intendedUse) {
      return fail(400, 'INCOMPLETE', 'Tell us who you are, how to reach you, and what you want to use it for.');
    }

    const motif = await prisma.motifRegistration.findUnique({
      where: { id: motifId },
      select: { id: true, name: true, clusterKey: true, status: true, licensable: true },
    });
    // A pending or flagged record is not public, so an enquiry against one is
    // refused rather than quietly queued against something nobody confirmed.
    if (!motif || motif.status !== 'REGISTERED') {
      return fail(404, 'NOT_FOUND', 'That motif record is not open for enquiries.');
    }
    if (!motif.licensable) {
      return fail(409, 'NOT_LICENSABLE', 'This cluster is not taking licensing enquiries for this motif.');
    }

    const ipHash = saltedIpHash(req);
    if (ipHash) {
      const since = new Date(Date.now() - LICENCE_RATE_WINDOW_MS);
      const recent = await prisma.motifLicence.count({
        where: { ipHash, createdAt: { gte: since } },
      });
      if (recent >= LICENCE_RATE_LIMIT) {
        return fail(429, 'RATE_LIMITED', 'Too many enquiries from here in the last hour. Try again later.');
      }
    }

    const licence = await prisma.motifLicence.create({
      data: {
        motifId: motif.id,
        licenseeName,
        licenseeContact,
        intendedUse,
        scope: scope || null,
        ipHash,
      },
      select: { id: true, status: true, createdAt: true },
    });

    // Tell the cluster, not just the artisan who filed the record: the motif is
    // theirs collectively, so the decision is theirs collectively.
    const artisanIds = await clusterArtisanIds(motif.clusterKey);
    await notifyCluster(
      artisanIds,
      licenceEnquiryTitle(motif.name),
      `${licenseeName} has asked to use this motif. Nothing is agreed — open your motif register to accept with a fee or decline.`
    ).catch((error) => console.warn('[motif/licence] notify failed:', (error as Error)?.message));

    return NextResponse.json(
      {
        success: true,
        licence: { id: licence.id, status: licence.status, createdAt: licence.createdAt.toISOString() },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[motif/licence] failed:', error);
    return fail(500, 'ENQUIRY_FAILED', 'Could not send that enquiry. Try again.');
  }
}
