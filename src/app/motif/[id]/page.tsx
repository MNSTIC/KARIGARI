import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { toPublicMotif } from "@/lib/motifLicence";
import { MotifRecordClient } from "./MotifRecordClient";

/**
 * The public record for one registered motif.
 *
 * Sessionless by design: a brand that wants to licence a village's pattern has
 * no account here, so this page must render with no cookie, no AI key and no
 * payment configuration — it touches nothing but the database.
 *
 * The row goes out through `toPublicMotif`, which builds the response field by
 * field from an allow-list. The submitting artisan's name is carried, for
 * credit; their id, mobile number, UPI id and email are absent because they were
 * never selected. The cluster appears under its readable name, never its raw
 * `auto:<location>` key.
 *
 * Only a REGISTERED record is public. A PENDING filing is not yet a record and a
 * FLAGGED_DUPLICATE one is an open question — publishing either would put an
 * unreviewed claim about a village's tradition on the open web.
 *
 * `noindex`: this is a working record for somebody who was given the link, not
 * a page to be surfaced by a search engine as though it were a registry entry.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Motif record · Karigari",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export default async function MotifRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const row = await prisma.motifRegistration.findFirst({
    where: { id, status: "REGISTERED" },
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
  });
  if (!row) notFound();

  return <MotifRecordClient motif={toPublicMotif(row)} />;
}
