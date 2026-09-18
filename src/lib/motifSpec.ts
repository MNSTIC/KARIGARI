import { PALETTES, paletteByKey } from '@/lib/motifPalettes';

/**
 * The Design Lab's pattern grammar, and the renderer that draws it.
 *
 * Pure: no Prisma, no React, no DOM. `renderMotifSvg` builds a string, so the
 * same function produces the server-side thumbnail and the live preview in the
 * browser and they cannot disagree.
 *
 * Three rules this file exists to hold:
 *
 *   1. **The spec is the truth, the SVG is a function of it.** A saved concept
 *      stores the grammar, not a picture; re-rendering it is byte-identical.
 *   2. **The output is safe by construction, not by sanitising.** Nothing from
 *      a model or an artisan is ever interpolated into the markup. Numbers are
 *      clamped to ranges, colours must match `/^#[0-9a-f]{6}$/i` or they are
 *      replaced, and the renderer emits only `<svg>`, `<defs>`, `<pattern>`,
 *      `<rect>`, `<g>`, `<path>`, `<circle>`, `<polygon>` and `<line>`. There
 *      is no text node, no `<foreignObject>`, no `<script>`, no `href` of any
 *      kind — so there is nothing for a prompt to escape into.
 *   3. **A drawing is a concept sketch.** Nothing here produces a photograph
 *      and nothing here may stand in for one.
 */

export const MOTIFS = [
  'diamond',
  'fish',
  'temple',
  'lotus',
  'chevron',
  'dot-grid',
  'ikat-blur',
  'stripe',
  'peacock-eye',
  'kalash',
] as const;

export const REPEATS = ['grid', 'brick', 'half-drop', 'mirror', 'diagonal'] as const;
export const BORDERS = ['none', 'temple', 'stripe', 'zigzag'] as const;

export type Motif = (typeof MOTIFS)[number];
export type Repeat = (typeof REPEATS)[number];
export type Border = (typeof BORDERS)[number];

export interface MotifSpec {
  v: 1;
  motif: Motif;
  repeat: Repeat;
  /** Cells across the cloth. */
  grid: number;
  /** Motif size within its cell. */
  scale: number;
  /** Degrees. */
  rotation: number;
  /** 2–6 validated hex colours. */
  palette: string[];
  strokeWidth: number;
  border: Border;
  background: string;
}

// ------------------------------------------------------------------- limits
// Exported so no slider and no test hard-codes a bound of its own.

export const GRID_MIN = 2;
export const GRID_MAX = 16;
export const SCALE_MIN = 0.2;
export const SCALE_MAX = 1;
export const ROTATION_MAX = 359;
export const STROKE_MIN = 0;
export const STROKE_MAX = 4;
export const PALETTE_MIN = 2;
export const PALETTE_MAX = 6;

/**
 * Above this many cells across the cloth, each motif drops to its outline.
 *
 * Two reasons, and the second is the honest one. The cost cap is structural:
 * the renderer emits ONE repeat unit inside a `<pattern>` and lets the browser
 * tile it, so a 16×16 grid draws the same handful of shapes a 2×2 does and the
 * output string is the same size either way. What actually changes at sixteen
 * cells is that each motif is about thirty pixels wide, where an eight-petal
 * lotus is a smudge — so the inner detail is dropped because it no longer
 * reads, not because the phone cannot paint it.
 */
export const DETAIL_CELL_LIMIT = 120;

export const HEX = /^#[0-9a-fA-F]{6}$/;

const FALLBACK_COLOUR = '#2b2b2b';
const FALLBACK_BACKGROUND = '#faf7f0';

// --------------------------------------------------------------- validation

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** A colour, or null. Three-digit hex is expanded; anything else is refused. */
export function normaliseColour(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim().toLowerCase();
  if (HEX.test(raw)) return raw;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(raw);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  return null;
}

/**
 * Clamp anything into a drawable spec. Never throws.
 *
 * A model that answers `motif: "elephant"`, `grid: 400` or `palette: ["red"]`
 * must degrade to the nearest allowed value rather than break the page, so
 * every field has a fallback and the palette is topped up from a committed one.
 */
export function validateSpec(raw: unknown): MotifSpec {
  const input = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;

  const motif = oneOf<Motif>(input.motif, MOTIFS, 'diamond');
  const colours: string[] = [];
  if (Array.isArray(input.palette)) {
    for (const entry of input.palette) {
      const colour = normaliseColour(entry);
      if (colour && !colours.includes(colour)) colours.push(colour);
      if (colours.length === PALETTE_MAX) break;
    }
  }
  // Too few usable colours: top up from a committed palette rather than
  // inventing one, so the result is still a colourway somebody chose.
  const filler = PALETTES[0].colours;
  for (let i = 0; colours.length < PALETTE_MIN; i += 1) {
    const next = normaliseColour(filler[i % filler.length]) ?? FALLBACK_COLOUR;
    if (!colours.includes(next)) colours.push(next);
    else if (i > filler.length) colours.push(FALLBACK_COLOUR);
  }

  return {
    v: 1,
    motif,
    repeat: oneOf<Repeat>(input.repeat, REPEATS, 'grid'),
    grid: Math.round(clamp(input.grid, GRID_MIN, GRID_MAX, 6)),
    scale: Math.round(clamp(input.scale, SCALE_MIN, SCALE_MAX, 0.7) * 100) / 100,
    rotation: Math.round(clamp(input.rotation, 0, ROTATION_MAX, 0)),
    palette: colours,
    strokeWidth: Math.round(clamp(input.strokeWidth, STROKE_MIN, STROKE_MAX, 1) * 10) / 10,
    border: oneOf<Border>(input.border, BORDERS, 'none'),
    background: normaliseColour(input.background) ?? FALLBACK_BACKGROUND,
  };
}

// ------------------------------------------------------------ deterministic
// A prompt with no AI still has to produce a spec somebody chose, not a random
// one: the same words must always give the same cloth.

/** FNV-1a. Small, dependency-free, and stable across runs and platforms. */
export function hashText(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Material families (src/lib/craftFamilies.ts) → the motif that suits the surface. */
const FAMILY_MOTIF: Record<string, Motif> = {
  'cotton-yarn': 'diamond',
  'silk-yarn': 'temple',
  'natural-dye': 'ikat-blur',
  'mirror-thread': 'dot-grid',
  'clay-quartz-glaze': 'lotus',
  'brass-bell-metal': 'kalash',
  'silver-inlay': 'chevron',
  'lac-wood': 'stripe',
  'stone-pigment': 'peacock-eye',
  'palm-leaf-paper': 'fish',
  'pashmina-wool': 'chevron',
};

/**
 * A starting spec for a craft, seeded from the artisan's own words.
 *
 * `seed` is the prompt text. The same prompt always produces the same cloth —
 * that is what makes the no-AI path a tool rather than a dice roll, and it is
 * what the determinism test asserts.
 */
export function defaultSpec(craftFamily: string, seed = ''): MotifSpec {
  const hash = hashText(`${craftFamily}|${seed}`);
  const palette = PALETTES[hash % PALETTES.length];
  const familyMotif = FAMILY_MOTIF[craftFamily];

  return validateSpec({
    v: 1,
    motif: familyMotif ?? MOTIFS[hash % MOTIFS.length],
    repeat: REPEATS[(hash >>> 3) % REPEATS.length],
    grid: 4 + ((hash >>> 6) % 5),
    scale: 0.55 + (((hash >>> 9) % 4) * 0.1),
    rotation: seed ? ((hash >>> 12) % 4) * 45 : 0,
    palette: palette.colours,
    strokeWidth: 1 + (((hash >>> 15) % 3) * 0.5),
    border: BORDERS[(hash >>> 18) % BORDERS.length],
    background: palette.background,
  });
}

// ----------------------------------------------------------------- renderer

/** Fixed-precision numbers, so the same spec always yields the same string. */
function n(value: number): string {
  return (Math.round(value * 1000) / 1000).toString();
}

interface CellContext {
  /** Cell size in user units. */
  size: number;
  /** Motif extent inside the cell. */
  span: number;
  ink: string;
  accent: string;
  stroke: number;
  /** False above DETAIL_CELL_LIMIT: outlines only. */
  detail: boolean;
}

/**
 * One motif, drawn in a cell of `size` with its centre at (size/2, size/2).
 *
 * Each is a handful of shapes. Ten drawn carefully beat forty drawn badly, and
 * every one of them is geometry — no glyphs, no text, nothing that could carry
 * a string through.
 */
function drawMotif(motif: Motif, c: CellContext): string {
  const half = c.size / 2;
  const r = c.span / 2;
  const fill = (colour: string) => `fill="${colour}"`;
  const line = `stroke="${c.ink}" stroke-width="${n(c.stroke)}" fill="none"`;

  switch (motif) {
    case 'diamond': {
      const outer = `<polygon points="${n(half)},${n(half - r)} ${n(half + r)},${n(half)} ${n(half)},${n(half + r)} ${n(half - r)},${n(half)}" ${fill(c.ink)}/>`;
      if (!c.detail) return outer;
      const ir = r * 0.45;
      return `${outer}<polygon points="${n(half)},${n(half - ir)} ${n(half + ir)},${n(half)} ${n(half)},${n(half + ir)} ${n(half - ir)},${n(half)}" ${fill(c.accent)}/>`;
    }
    case 'fish': {
      const body = `<path d="M ${n(half - r)} ${n(half)} Q ${n(half)} ${n(half - r * 0.8)} ${n(half + r * 0.55)} ${n(half)} Q ${n(half)} ${n(half + r * 0.8)} ${n(half - r)} ${n(half)} Z" ${fill(c.ink)}/>`;
      if (!c.detail) return body;
      const tail = `<polygon points="${n(half + r * 0.55)},${n(half)} ${n(half + r)},${n(half - r * 0.45)} ${n(half + r)},${n(half + r * 0.45)}" ${fill(c.accent)}/>`;
      return `${body}${tail}<circle cx="${n(half - r * 0.45)}" cy="${n(half - r * 0.12)}" r="${n(r * 0.1)}" ${fill(c.accent)}/>`;
    }
    case 'temple': {
      const base = half + r;
      const tri = `<polygon points="${n(half)},${n(half - r)} ${n(half + r)},${n(base)} ${n(half - r)},${n(base)}" ${fill(c.ink)}/>`;
      if (!c.detail) return tri;
      return `${tri}<polygon points="${n(half)},${n(half - r * 0.45)} ${n(half + r * 0.45)},${n(base)} ${n(half - r * 0.45)},${n(base)}" ${fill(c.accent)}/>`;
    }
    case 'lotus': {
      const petals: string[] = [];
      const count = c.detail ? 8 : 4;
      for (let i = 0; i < count; i += 1) {
        const angle = (360 / count) * i;
        petals.push(
          `<path d="M ${n(half)} ${n(half)} Q ${n(half - r * 0.35)} ${n(half - r * 0.75)} ${n(half)} ${n(half - r)} Q ${n(half + r * 0.35)} ${n(half - r * 0.75)} ${n(half)} ${n(half)} Z" ${fill(i % 2 === 0 ? c.ink : c.accent)} transform="rotate(${n(angle)} ${n(half)} ${n(half)})"/>`
        );
      }
      return petals.join('');
    }
    case 'chevron': {
      const rows = c.detail ? 3 : 1;
      const out: string[] = [];
      for (let i = 0; i < rows; i += 1) {
        const y = half - r + ((r * 2) / rows) * i + r / rows;
        out.push(
          `<path d="M ${n(half - r)} ${n(y)} L ${n(half)} ${n(y - r * 0.4)} L ${n(half + r)} ${n(y)}" stroke="${i % 2 === 0 ? c.ink : c.accent}" stroke-width="${n(Math.max(c.stroke, c.span * 0.12))}" fill="none"/>`
        );
      }
      return out.join('');
    }
    case 'dot-grid': {
      const dots: string[] = [];
      const per = c.detail ? 3 : 2;
      for (let x = 0; x < per; x += 1) {
        for (let y = 0; y < per; y += 1) {
          const cx = half - r + (r * 2 * (x + 0.5)) / per;
          const cy = half - r + (r * 2 * (y + 0.5)) / per;
          dots.push(`<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r / (per * 2.2))}" ${fill((x + y) % 2 === 0 ? c.ink : c.accent)}/>`);
        }
      }
      return dots.join('');
    }
    case 'ikat-blur': {
      // The feathered edge a resist-dyed yarn gives, drawn as stepped bars
      // rather than a blur filter — filters are expensive and this reads truer.
      const bars: string[] = [];
      const steps = c.detail ? 5 : 3;
      for (let i = 0; i < steps; i += 1) {
        const w = (c.span / steps) * (i % 2 === 0 ? 1 : 0.55);
        const y = half - r + ((r * 2) / steps) * i;
        bars.push(`<rect x="${n(half - w / 2)}" y="${n(y)}" width="${n(w)}" height="${n((r * 2) / steps)}" ${fill(i % 2 === 0 ? c.ink : c.accent)}/>`);
      }
      return bars.join('');
    }
    case 'stripe': {
      const bands = c.detail ? 4 : 2;
      const out: string[] = [];
      for (let i = 0; i < bands; i += 1) {
        const w = c.span / bands;
        out.push(`<rect x="${n(half - r + w * i)}" y="${n(half - r)}" width="${n(w * 0.6)}" height="${n(r * 2)}" ${fill(i % 2 === 0 ? c.ink : c.accent)}/>`);
      }
      return out.join('');
    }
    case 'peacock-eye': {
      const eye = `<ellipse cx="${n(half)}" cy="${n(half)}" rx="${n(r)}" ry="${n(r * 0.75)}" ${fill(c.ink)}/>`;
      if (!c.detail) return eye;
      return `${eye}<ellipse cx="${n(half)}" cy="${n(half)}" rx="${n(r * 0.55)}" ry="${n(r * 0.4)}" ${fill(c.accent)}/><circle cx="${n(half)}" cy="${n(half)}" r="${n(r * 0.16)}" ${fill(c.ink)}/>`;
    }
    case 'kalash': {
      const body = `<path d="M ${n(half - r * 0.6)} ${n(half - r * 0.2)} Q ${n(half)} ${n(half + r)} ${n(half + r * 0.6)} ${n(half - r * 0.2)} Z" ${fill(c.ink)}/>`;
      if (!c.detail) return body;
      return `${body}<rect x="${n(half - r * 0.45)}" y="${n(half - r * 0.45)}" width="${n(r * 0.9)}" height="${n(r * 0.25)}" ${fill(c.accent)}/><circle cx="${n(half)}" cy="${n(half - r * 0.7)}" r="${n(r * 0.18)}" ${fill(c.accent)}/>`;
    }
    default:
      return `<circle cx="${n(half)}" cy="${n(half)}" r="${n(r)}" ${line}/>`;
  }
}

/**
 * The smallest block of cells that repeats, for each of the five rules.
 *
 * This is what makes the renderer's output a constant size: the block below is
 * drawn once into a `<pattern>` and the browser tiles it, so a 16×16 grid emits
 * exactly as much markup as a 2×2 one. Each rule's offsets are chosen to divide
 * evenly into its own block, so no cell is clipped at the tile edge and the
 * seam between tiles is invisible.
 */
const REPEAT_BLOCK: Record<Repeat, { cols: number; rows: number }> = {
  grid: { cols: 1, rows: 1 },
  brick: { cols: 2, rows: 2 },
  'half-drop': { cols: 2, rows: 2 },
  mirror: { cols: 2, rows: 2 },
  diagonal: { cols: 4, rows: 4 },
};

/** Where one cell of the repeat block sits inside it. */
function cellOffset(repeat: Repeat, col: number, row: number, size: number): { dx: number; dy: number; flip: boolean } {
  switch (repeat) {
    case 'brick':
      return { dx: row % 2 === 1 ? size / 2 : 0, dy: 0, flip: false };
    case 'half-drop':
      return { dx: 0, dy: col % 2 === 1 ? size / 2 : 0, flip: false };
    case 'mirror':
      return { dx: 0, dy: 0, flip: (col + row) % 2 === 1 };
    case 'diagonal':
      return { dx: ((row % 4) * size) / 4, dy: 0, flip: false };
    case 'grid':
    default:
      return { dx: 0, dy: 0, flip: false };
  }
}

function drawBorder(border: Border, side: number, ink: string, accent: string): string {
  const band = side * 0.06;
  if (border === 'none') return '';
  if (border === 'stripe') {
    return (
      `<rect x="0" y="0" width="${n(side)}" height="${n(band)}" fill="${ink}"/>` +
      `<rect x="0" y="${n(side - band)}" width="${n(side)}" height="${n(band)}" fill="${ink}"/>` +
      `<rect x="0" y="${n(band)}" width="${n(side)}" height="${n(band / 3)}" fill="${accent}"/>` +
      `<rect x="0" y="${n(side - band - band / 3)}" width="${n(side)}" height="${n(band / 3)}" fill="${accent}"/>`
    );
  }
  const teeth = 16;
  const step = side / teeth;
  const top: string[] = [];
  const bottom: string[] = [];
  for (let i = 0; i < teeth; i += 1) {
    const x = step * i;
    if (border === 'temple') {
      top.push(`<polygon points="${n(x)},${n(band)} ${n(x + step / 2)},0 ${n(x + step)},${n(band)}" fill="${i % 2 === 0 ? ink : accent}"/>`);
      bottom.push(`<polygon points="${n(x)},${n(side - band)} ${n(x + step / 2)},${n(side)} ${n(x + step)},${n(side - band)}" fill="${i % 2 === 0 ? ink : accent}"/>`);
    } else {
      top.push(`<polyline points="${n(x)},0 ${n(x + step / 2)},${n(band)} ${n(x + step)},0" stroke="${ink}" stroke-width="${n(band / 4)}" fill="none"/>`);
      bottom.push(`<polyline points="${n(x)},${n(side)} ${n(x + step / 2)},${n(side - band)} ${n(x + step)},${n(side)}" stroke="${ink}" stroke-width="${n(band / 4)}" fill="none"/>`);
    }
  }
  return top.join('') + bottom.join('');
}

/**
 * Draw a spec. Pure and deterministic: the same spec always returns the same
 * string, byte for byte.
 *
 * `size` is the viewBox side; the SVG itself is responsive (`width="100%"`), so
 * the caller sizes it with CSS rather than with this number.
 */
export function renderMotifSvg(spec: MotifSpec, size = 480): string {
  const s = validateSpec(spec);
  const side = Math.min(2000, Math.max(120, Math.round(size)));
  const cells = s.grid;
  const cellSize = side / cells;
  const detail = cells * cells <= DETAIL_CELL_LIMIT;

  const ink = s.palette[0] ?? FALLBACK_COLOUR;
  const accent = s.palette[1] ?? ink;
  const third = s.palette[2] ?? accent;

  const context: CellContext = {
    size: cellSize,
    span: cellSize * s.scale,
    ink,
    accent,
    stroke: s.strokeWidth,
    detail,
  };

  const motif = drawMotif(s.motif, context);
  const block = REPEAT_BLOCK[s.repeat];
  const cellsOut: string[] = [];
  for (let row = 0; row < block.rows; row += 1) {
    for (let col = 0; col < block.cols; col += 1) {
      const { dx, dy, flip } = cellOffset(s.repeat, col, row, cellSize);
      const x = col * cellSize + dx;
      const y = row * cellSize + dy;
      // Two transforms at most per cell: the repeat's placement, then the
      // spec's own rotation about the cell centre.
      const spin = s.rotation === 0 ? '' : ` rotate(${n(s.rotation)} ${n(cellSize / 2)} ${n(cellSize / 2)})`;
      const mirror = flip ? ` scale(-1 1) translate(${n(-cellSize)} 0)` : '';
      cellsOut.push(`<g transform="translate(${n(x)} ${n(y)})${mirror}${spin}">${motif}</g>`);
    }
  }

  // A third colour, used as a quiet wash under the motifs so a two-colour
  // palette still reads as cloth rather than as a diagram.
  const wash = third === ink ? '' : `<rect x="0" y="0" width="${n(side)}" height="${n(side)}" fill="${third}" opacity="0.14"/>`;
  const tileW = cellSize * block.cols;
  const tileH = cellSize * block.rows;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(side)} ${n(side)}" width="100%" height="100%" role="img" aria-hidden="true">` +
    `<defs><pattern id="kg-motif-tile" patternUnits="userSpaceOnUse" width="${n(tileW)}" height="${n(tileH)}">` +
    cellsOut.join('') +
    `</pattern></defs>` +
    `<rect x="0" y="0" width="${n(side)}" height="${n(side)}" fill="${s.background}"/>` +
    wash +
    `<rect x="0" y="0" width="${n(side)}" height="${n(side)}" fill="url(#kg-motif-tile)"/>` +
    drawBorder(s.border, side, ink, accent) +
    `</svg>`
  );
}

/** How many shapes a spec will draw, for the cost cap the preview respects. */
export function drawnCellCount(spec: MotifSpec): number {
  return validateSpec(spec).grid ** 2;
}

/** The committed palette a spec's colours came from, when they came from one. */
export function paletteKeyFor(spec: MotifSpec): string | null {
  for (const palette of PALETTES) {
    if (palette.colours.every((colour) => spec.palette.includes(colour.toLowerCase()))) return palette.key;
  }
  return null;
}

export { PALETTES, paletteByKey };
