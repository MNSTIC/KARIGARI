import { ProductClient } from "./ProductClient";

/**
 * Public product page.
 *
 * `params` is a Promise in this version of Next — awaited here in the server
 * wrapper so the client component below receives a plain id, the same shape
 * `verify/[patchId]` uses.
 */
export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProductClient id={id} />;
}
