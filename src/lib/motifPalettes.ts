/**
 * Committed colour palettes for the Design Lab.
 *
 * Pure data. Every palette is named for the **dyestuffs** it is built from —
 * indigo, madder, turmeric, iron black — because those are real, verifiable
 * materials an artisan buys. None of them is named for, or claimed to belong
 * to, a particular community, region or registered craft: this app makes no
 * claim about who a colourway belongs to, and a generated pattern is a starting
 * point the artisan edits, never "an authentic X motif".
 *
 * The hex values are ordinary web colours chosen to sit together on screen.
 * They are not dye recipes and the UI does not present them as one.
 */

export interface Palette {
  key: string;
  /** i18n key for the name the artisan reads. */
  labelKey: string;
  /** 2–6 colours, darkest-to-lightest is not required. */
  colours: string[];
  background: string;
}

export const PALETTES: readonly Palette[] = [
  {
    key: 'indigo-madder',
    labelKey: 'palette_indigo_madder',
    colours: ['#1f3a68', '#9c3b2e', '#e8dcc8'],
    background: '#f6f1e6',
  },
  {
    key: 'turmeric-iron',
    labelKey: 'palette_turmeric_iron',
    colours: ['#d9a021', '#2b2b2b', '#f0e6d2'],
    background: '#fbf7ee',
  },
  {
    key: 'madder-cream',
    labelKey: 'palette_madder_cream',
    colours: ['#a83232', '#7a1f1f', '#f3e7d3'],
    background: '#fdf8ef',
  },
  {
    key: 'indigo-resist',
    labelKey: 'palette_indigo_resist',
    colours: ['#16324f', '#3f6f9c', '#f5f2e9'],
    background: '#eef3f7',
  },
  {
    key: 'lac-ochre',
    labelKey: 'palette_lac_ochre',
    colours: ['#b34a1f', '#e0a43b', '#3d2c1e'],
    background: '#fbf2e3',
  },
  {
    key: 'bell-metal',
    labelKey: 'palette_bell_metal',
    colours: ['#8a6a2f', '#c9a961', '#2e2a24'],
    background: '#f4efe4',
  },
  {
    key: 'stone-pigment',
    labelKey: 'palette_stone_pigment',
    colours: ['#6d7f52', '#a8452c', '#efe6d0'],
    background: '#faf6ea',
  },
  {
    key: 'undyed-cotton',
    labelKey: 'palette_undyed_cotton',
    colours: ['#3a3a3a', '#b9ab92', '#f2ece0'],
    background: '#fbf9f3',
  },
];

export function paletteByKey(key: string): Palette | null {
  return PALETTES.find((p) => p.key === key) ?? null;
}

/** Every colour any committed palette offers, for the swatch picker. */
export function paletteColours(): string[] {
  return [...new Set(PALETTES.flatMap((p) => p.colours))];
}
