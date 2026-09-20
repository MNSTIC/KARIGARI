import type { Metadata } from "next";
import { loadPassportById } from "@/lib/passport";
import { ProductClient } from "./ProductClient";

/**
 * Public product page.
 *
 * `params` is a Promise in this version of Next — awaited here in the server
 * wrapper. The buy flow stays in the client component, which reads its own
 * live item state; the passport sections (story, timeline, trust layers,
 * similar request, more from the artisan) are loaded here on the server, once
 * per request for both the metadata and the page.
 */

/** Meta descriptions are cut here, at a word boundary. */
const META_DESCRIPTION_CHARS = 160;

function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= META_DESCRIPTION_CHARS) return flat;
  const cut = flat.slice(0, META_DESCRIPTION_CHARS);
  return `${cut.slice(0, Math.max(0, cut.lastIndexOf(" ")))}…`;
}

export const revalidate = 60;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const passport = await loadPassportById(id);
  if (!passport) return { title: "Karigari marketplace" };
  const title = `${passport.craftType} by ${passport.artisan.name} · Karigari`;
  const source = passport.descriptionEnglish || passport.aiGeneratedListing || "";
  return {
    title,
    ...(source ? { description: clip(source) } : {}),
    openGraph: { title, ...(source ? { description: clip(source) } : {}) },
  };
}

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const passport = await loadPassportById(id);
  return <ProductClient id={id} passport={passport} />;
}
