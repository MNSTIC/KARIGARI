import type { Metadata } from "next";
import { ScrapBoardClient } from "./ScrapBoardClient";

/**
 * The public scrap board.
 *
 * Sessionless by design: a recycler has no account here, and requiring one
 * would mean the board only ever reaches people who already know about this
 * platform. It touches nothing but `/api/scrap/pools`, which itself needs no
 * cookie, no AI key and no payment configuration.
 *
 * `noindex`: this is a working board of what a handful of villages have on hand
 * this month, not a directory to be surfaced by a search engine. The pools it
 * lists are real weights logged by real people, and a cached copy of a lot that
 * has already been sold — or withdrawn — would send somebody on a wasted trip.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Craft scrap for collection · Karigari",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export default function ScrapBoardPage() {
  return <ScrapBoardClient />;
}
