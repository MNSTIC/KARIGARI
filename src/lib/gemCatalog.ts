import { getListingPrice } from '@/lib/pricing';
import { absoluteImages, type CatalogItem } from '@/lib/ondcCatalog';

/**
 * GeM (Government e-Marketplace) catalog serializer.
 *
 * Deterministic on purpose: no model call anywhere in this file. A seller
 * downloading their catalog on a rural connection cannot be left waiting on an
 * API quota, and the same rows must come out the same way every time.
 *
 * GeM has no public seller "push" API — sellers upload a catalog through the
 * portal. This produces the upload-ready file; it transmits nothing.
 */

/**
 * Indicative HSN codes by craft keyword.
 *
 * HSN drives tax, and the seller is liable for the value they file, so a guess
 * must never be presented as final. Anything unmatched is left blank and
 * flagged for confirmation rather than filled with a plausible-looking code.
 */
const HSN_RULES: { match: RegExp; hsn: string; gst: string }[] = [
  { match: /\bsilk\b/i, hsn: '5007', gst: '5' },
  { match: /carpet|rug|durrie|dhurrie/i, hsn: '5705', gst: '5' },
  { match: /shawl|scarf|stole|dupatta/i, hsn: '6214', gst: '5' },
  { match: /bedcover|bed cover|furnishing|made-?up|cushion|curtain/i, hsn: '6304', gst: '5' },
  { match: /jute/i, hsn: '6305', gst: '5' },
  { match: /terracotta|pottery|ceramic|clay/i, hsn: '6913', gst: '' },
  { match: /bamboo|cane|basket|wicker/i, hsn: '4602', gst: '' },
  { match: /wood|wooden|carving/i, hsn: '4420', gst: '' },
  { match: /brass|metal|dokra|bell metal|filigree/i, hsn: '8306', gst: '' },
  // Checked last: "cotton" and "handloom" appear inside many craft names, so a
  // more specific rule above should win first.
  { match: /cotton|handloom|saree|sari|fabric|textile|ikat|weav/i, hsn: '5208', gst: '5' },
];

export interface GemRow {
  'Product Name': string;
  Brand: string;
  'Brand Type': string;
  'Model Number': string;
  Category: string;
  'Sub-Category': string;
  'HSN Code': string;
  'Product Description': string;
  Specifications: string;
  'MRP (INR)': string;
  'Selling Price (INR)': string;
  'Minimum Order Quantity': string;
  'Available Stock': string;
  'Unit of Measurement': string;
  'Country of Origin': string;
  'GST (%)': string;
  'Seller SKU': string;
  'Image URL 1': string;
  'Image URL 2': string;
  'Image URL 3': string;
}

export const GEM_COLUMNS: (keyof GemRow)[] = [
  'Product Name',
  'Brand',
  'Brand Type',
  'Model Number',
  'Category',
  'Sub-Category',
  'HSN Code',
  'Product Description',
  'Specifications',
  'MRP (INR)',
  'Selling Price (INR)',
  'Minimum Order Quantity',
  'Available Stock',
  'Unit of Measurement',
  'Country of Origin',
  'GST (%)',
  'Seller SKU',
  'Image URL 1',
  'Image URL 2',
  'Image URL 3',
];

/** Returns a blank code rather than a guess when nothing matches. */
export function hsnFor(craftType: string, tags: string[] = []): { hsn: string; gst: string } {
  const haystack = [craftType, ...tags].join(' ');
  for (const rule of HSN_RULES) {
    if (rule.match.test(haystack)) return { hsn: rule.hsn, gst: rule.gst };
  }
  return { hsn: '', gst: '' };
}

/** Empty string, never "undefined"/"null"/"NaN", so no cell shows a JS artefact. */
function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  return String(value);
}

function money(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(Math.round(value)) : '';
}

export function toGemRows(items: CatalogItem[], origin: string): GemRow[] {
  return items.map((item) => {
    const sellPrice = item.salePrice ?? getListingPrice(item);
    const { hsn, gst } = hsnFor(item.craftType, item.tags ?? []);
    // GeM fetches these columns as URLs, so an inline data: URI is useless to it
    // and would bloat one cell to hundreds of kilobytes. Beckn keeps data URIs
    // (a self-contained payload is valid there); a spreadsheet cannot. Blank
    // here means "upload the photo on the portal", which the guide already says.
    const images = absoluteImages(item.images ?? [], origin)
      .filter((src) => /^https?:/i.test(src))
      .slice(0, 3);

    const giTag = item.giTagApplied || item.artisan?.artisanProfile?.giTagName || '';
    const productName = giTag ? `${item.craftType} (${giTag} GI)` : item.craftType;

    const specs = Array.from(new Set([...(item.tags ?? []), item.craftType].filter(Boolean))).join(', ');

    return {
      'Product Name': cell(productName),
      Brand: 'Unbranded',
      'Brand Type': 'Unbranded',
      'Model Number': cell(item.patchId || item.id),
      Category: 'Handloom & Handicrafts',
      'Sub-Category': cell(item.aiSuggestedCategory?.trim() || item.craftType),
      'HSN Code': hsn,
      'Product Description': cell(
        item.aiGeneratedListing || item.descriptionEnglish || item.craftType
      ),
      Specifications: cell(specs),
      'MRP (INR)': money(item.standardMarketPrice ?? item.marketPriceMax ?? sellPrice),
      'Selling Price (INR)': money(sellPrice),
      'Minimum Order Quantity': '1',
      'Available Stock': '1',
      'Unit of Measurement': 'Piece',
      'Country of Origin': 'India',
      'GST (%)': gst,
      'Seller SKU': cell(item.id),
      'Image URL 1': cell(images[0]),
      'Image URL 2': cell(images[1]),
      'Image URL 3': cell(images[2]),
    };
  });
}

/**
 * RFC 4180 field escaping.
 *
 * Craft descriptions routinely contain commas, and artisan quotes contain
 * double quotes; either one un-escaped shifts every later column and silently
 * corrupts the upload.
 */
function escapeCsv(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * A UTF-8 BOM is prepended because Excel otherwise reads the file as ANSI and
 * renders Hindi, Odia and Telugu as mojibake — the seller's own language being
 * unreadable in their own catalog.
 */
export function toGemCsv(rows: GemRow[]): string {
  const header = GEM_COLUMNS.map((c) => escapeCsv(c)).join(',');
  const body = rows.map((row) => GEM_COLUMNS.map((c) => escapeCsv(row[c] ?? '')).join(','));
  return `﻿${[header, ...body].join('\r\n')}\r\n`;
}

export function toGemJson(rows: GemRow[]): string {
  return JSON.stringify(
    {
      catalog: 'GeM',
      generatedAt: new Date().toISOString(),
      note: 'Upload-ready catalog for gem.gov.in. HSN and GST are indicative — confirm both on the GeM portal before publishing. KARIGARI does not transmit anything to GeM.',
      columns: GEM_COLUMNS,
      count: rows.length,
      products: rows,
    },
    null,
    2
  );
}
