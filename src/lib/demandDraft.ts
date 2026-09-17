/**
 * The fixed vocabularies of the "Raise a demand" form, and the draft shape a
 * caller may prefill it with.
 *
 * These lists used to live inside PostDemandModal.tsx. They moved here when the
 * buyer passport gained "Want something similar?", which prefills the form from
 * the piece being viewed: the prefill must resolve to exactly the category,
 * product type and material chips the form offers, or the buyer would open a
 * form whose selections silently fail to match its own options.
 */

/**
 * The category list. Fixed rather than free text because this is the one field
 * the matcher compares ACROSS artisans — a buyer inventing their own category
 * name would score against nobody.
 */
export const DEMAND_CATEGORIES = [
  "Saree & Textile",
  "Pottery & Ceramics",
  "Jewellery",
  "Handicraft",
  "Painting & Art",
  "Furniture",
  "Home Décor",
  "Metalwork",
  "Leather",
  "Other",
] as const;

export type DemandCategory = (typeof DEMAND_CATEGORIES)[number];

/**
 * Suggestions for the product type, per category. A datalist, not a select: the
 * point is to save typing for the common case without blocking a buyer whose
 * article is not on anyone's list.
 */
export const DEMAND_PRODUCT_TYPES: Record<string, string[]> = {
  "Saree & Textile": ["Saree", "Dupatta", "Stole", "Shawl", "Running fabric", "Kurta piece"],
  "Pottery & Ceramics": ["Dinner set", "Vase", "Planter", "Water jug", "Serving bowl"],
  Jewellery: ["Necklace", "Earrings", "Bangle set", "Anklet", "Ring"],
  Handicraft: ["Wall hanging", "Basket", "Toy", "Mask", "Figurine"],
  "Painting & Art": ["Canvas", "Scroll", "Framed print", "Wall mural"],
  Furniture: ["Chair", "Stool", "Coffee table", "Cabinet", "Bed frame"],
  "Home Décor": ["Lamp", "Cushion cover", "Table runner", "Mirror frame"],
  Metalwork: ["Lamp", "Idol", "Bowl", "Tray", "Bell"],
  Leather: ["Bag", "Wallet", "Footwear", "Belt", "Journal cover"],
};

/** Chips for the material field. "Other" reveals the free-text input. */
export const DEMAND_MATERIALS = ["Cotton", "Silk", "Wool", "Wood", "Clay", "Metal", "Leather", "Bamboo", "Other"];

/**
 * What a caller may prefill. Every field is the form's own string value, so a
 * prefill is exactly what the buyer would have typed or picked — editable, and
 * never submitted on its own.
 */
export interface DemandDraft {
  category: string;
  productType: string;
  craftType: string;
  description: string;
  material: string;
  /** Only read when `material` is "Other". */
  materialOther: string;
  color: string;
  /** Data URLs, as POST /api/demand requires. */
  referenceImageUrls: string[];
}
