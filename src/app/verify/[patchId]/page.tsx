import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadPassportByPatchId } from "@/lib/passport";
import { VerificationClient } from "./VerificationClient";

/**
 * The QR-scan passport. One page per physical object, so it is kept out of
 * search indexes; it is not content.
 *
 * The record is loaded once per request (`cache()` in src/lib/passport.ts) for
 * both the metadata and the page. A patch that does not exist, or whose piece
 * was deleted, is a 404.
 */
export const revalidate = 60;

export async function generateMetadata({ params }: { params: Promise<{ patchId: string }> }): Promise<Metadata> {
  const { patchId } = await params;
  const passport = await loadPassportByPatchId(patchId);
  return {
    title: passport ? `${passport.craftType} · Craft passport · Karigari` : "Craft passport · Karigari",
    robots: { index: false, follow: false },
  };
}

export default async function VerifyPassport({ params }: { params: Promise<{ patchId: string }> }) {
  const { patchId } = await params;
  const passport = await loadPassportByPatchId(patchId);
  if (!passport) notFound();
  return <VerificationClient passport={passport} />;
}
