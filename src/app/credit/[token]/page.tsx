import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { openCreditShare } from "@/lib/creditRecord";
import { CreditRecordClient } from "./CreditRecordClient";

/**
 * The page a loan officer opens from an artisan's share link.
 *
 * Public and sessionless: the token in the URL is the only capability. Rendered
 * on the server from the frozen snapshot — it touches no AI service and no
 * network beyond the database, so it works with every AI key absent.
 *
 * A token that never existed is a 404. A revoked or expired link renders the
 * "no longer available" state with no data in it.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Production Record · Karigari",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export default async function CreditRecordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await openCreditShare(token);
  if (result.state === "NOT_FOUND") notFound();
  return <CreditRecordClient record={result.state === "FOUND" ? result.record : null} />;
}
