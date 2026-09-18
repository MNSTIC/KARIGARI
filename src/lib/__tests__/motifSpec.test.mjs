/**
 * What the motif composer is allowed to draw.
 *
 * The rule this file exists to enforce: the SVG is rendered from a validated
 * spec by our own code, and a model's answer or an artisan's prompt never
 * reaches the markup. So a malformed spec must clamp rather than throw, and the
 * rendered string must contain no script, no foreignObject, no external URL and
 * none of the prompt text — checked against a spec deliberately stuffed with an
 * injection attempt.
 *
 * Plain Node, no test framework — the same convention as orderStage.test.mjs.
 *   node src/lib/__tests__/motifSpec.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const outDir = mkdtempSync(path.join(tmpdir(), 'karigari-motif-'));
const outfile = path.join(outDir, 'motifSpec.mjs');
await esbuild.build({
  entryPoints: ['src/lib/motifSpec.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  logLevel: 'error',
  alias: { '@': path.resolve('src') },
});
const M = await import(pathToFileURL(outfile).href);

let failures = 0;
let checks = 0;
function test(name, fn) {
  checks += 1;
  try {
    fn();
  } catch (e) {
    failures += 1;
    console.log(`FAIL  ${name}\n      ${e.message.split('\n').slice(0, 4).join('\n      ')}`);
  }
}

// -------------------------------------------------------------- validation

test('garbage in gives a drawable spec rather than a throw', () => {
  for (const raw of [null, undefined, 'text', 42, [], {}, { motif: {} }, NaN]) {
    const spec = M.validateSpec(raw);
    assert.ok(M.MOTIFS.includes(spec.motif), String(raw));
    assert.ok(M.REPEATS.includes(spec.repeat));
    assert.ok(M.BORDERS.includes(spec.border));
    assert.ok(spec.palette.length >= M.PALETTE_MIN);
  }
});

test('an unknown motif, repeat or border degrades to the nearest allowed value', () => {
  const spec = M.validateSpec({ motif: 'elephant', repeat: 'spiral', border: 'gold-thread' });
  assert.equal(spec.motif, 'diamond');
  assert.equal(spec.repeat, 'grid');
  assert.equal(spec.border, 'none');
});

test('every numeric field is clamped to its own published range', () => {
  const high = M.validateSpec({ grid: 400, scale: 9, rotation: 5000, strokeWidth: 99 });
  assert.equal(high.grid, M.GRID_MAX);
  assert.equal(high.scale, M.SCALE_MAX);
  assert.equal(high.rotation, M.ROTATION_MAX);
  assert.equal(high.strokeWidth, M.STROKE_MAX);

  const low = M.validateSpec({ grid: -8, scale: -1, rotation: -90, strokeWidth: -3 });
  assert.equal(low.grid, M.GRID_MIN);
  assert.equal(low.scale, M.SCALE_MIN);
  assert.equal(low.rotation, 0);
  assert.equal(low.strokeWidth, M.STROKE_MIN);

  assert.equal(M.validateSpec({ grid: 6.7 }).grid, 7, 'grid is a whole number of cells');
});

test('a bad colour is refused and the palette is topped up, never left short', () => {
  const spec = M.validateSpec({ palette: ['red', 'rgb(1,2,3)', '#12', null, 42] });
  assert.ok(spec.palette.length >= M.PALETTE_MIN, JSON.stringify(spec.palette));
  for (const colour of spec.palette) assert.ok(M.HEX.test(colour), colour);
});

test('a three-digit hex is expanded, and a good palette is kept in order', () => {
  const spec = M.validateSpec({ palette: ['#ABC', '#112233', '#112233'] });
  assert.deepEqual(spec.palette, ['#aabbcc', '#112233'], 'duplicates dropped, case normalised');
});

test('a palette longer than the maximum is truncated, not rejected', () => {
  const many = ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666', '#777777', '#888888'];
  assert.equal(M.validateSpec({ palette: many }).palette.length, M.PALETTE_MAX);
});

test('a bad background falls back rather than painting an invalid fill', () => {
  assert.ok(M.HEX.test(M.validateSpec({ background: 'javascript:alert(1)' }).background));
});

// ------------------------------------------------------------- determinism

test('the same spec renders byte-identical every time', () => {
  const spec = M.defaultSpec('silk-yarn', 'a river pattern in indigo');
  assert.equal(M.renderMotifSvg(spec), M.renderMotifSvg(spec));
  assert.equal(M.renderMotifSvg(spec, 240), M.renderMotifSvg(M.validateSpec(spec), 240));
});

test('the same prompt always gives the same cloth, so the no-AI path is a tool', () => {
  const a = M.defaultSpec('cotton-yarn', 'fish and temple border for a saree');
  const b = M.defaultSpec('cotton-yarn', 'fish and temple border for a saree');
  assert.deepEqual(a, b);
  const c = M.defaultSpec('cotton-yarn', 'something else entirely');
  assert.notDeepEqual(a, c, 'and different words give different cloth');
});

test('a craft family picks a motif that suits its surface', () => {
  assert.equal(M.defaultSpec('clay-quartz-glaze', 'x').motif, 'lotus');
  assert.equal(M.defaultSpec('brass-bell-metal', 'x').motif, 'kalash');
  // A family nobody has heard of still draws something.
  assert.ok(M.MOTIFS.includes(M.defaultSpec('moon-cheese', 'x').motif));
});

// ------------------------------------------------------ safe by construction

const INJECTION = '"><script>alert(1)</script><a href="http://evil.test">';

test('nothing a prompt says can reach the markup', () => {
  const spec = M.validateSpec({
    motif: INJECTION,
    repeat: INJECTION,
    border: INJECTION,
    background: INJECTION,
    palette: [INJECTION, '#112233', '#445566'],
  });
  const svg = M.renderMotifSvg(spec);
  assert.ok(!svg.includes('script'), 'script survived');
  assert.ok(!svg.includes('alert'), 'alert survived');
  assert.ok(!svg.includes('evil.test'), 'a URL survived');
  assert.ok(!svg.includes('<a '), 'an anchor survived');
});

test('the output carries no script, no foreignObject and no external reference', () => {
  for (const motif of M.MOTIFS) {
    for (const border of M.BORDERS) {
      const svg = M.renderMotifSvg(M.validateSpec({ motif, border, grid: 5 }));
      assert.ok(!/<script/i.test(svg), `${motif}/${border}: script`);
      assert.ok(!/foreignObject/i.test(svg), `${motif}/${border}: foreignObject`);
      assert.ok(!/https?:\/\/(?!www\.w3\.org\/2000\/svg)/i.test(svg), `${motif}/${border}: external URL`);
      assert.ok(!/<text|<image|xlink:href|\son\w+=/i.test(svg), `${motif}/${border}: text, image or handler`);
    }
  }
});

test('the only references in the output are the SVG namespace and our own tile', () => {
  const svg = M.renderMotifSvg(M.defaultSpec('cotton-yarn', 'x'));
  const urls = svg.match(/(?:https?:)?\/\/[^"\s]+|url\([^)]*\)/g) ?? [];
  assert.deepEqual(
    [...new Set(urls)].sort(),
    ['http://www.w3.org/2000/svg', 'url(#kg-motif-tile)'].sort(),
    urls.join(' ')
  );
});

test('every motif and every repeat actually draws something', () => {
  for (const motif of M.MOTIFS) {
    for (const repeat of M.REPEATS) {
      const svg = M.renderMotifSvg(M.validateSpec({ motif, repeat, grid: 4 }));
      assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>'), `${motif}/${repeat}`);
      assert.ok(svg.length > 400, `${motif}/${repeat} drew almost nothing: ${svg.length} chars`);
      // One repeat block, not one group per cell: the browser tiles it.
      const block = { grid: 1, brick: 4, 'half-drop': 4, mirror: 4, diagonal: 16 }[repeat];
      assert.equal((svg.match(/<g transform=/g) || []).length, block, `${motif}/${repeat} block size`);
    }
  }
});

// ------------------------------------------------------------- the cost cap

test('a dense grid drops to outlines, because the motif is too small to read', () => {
  const dense = M.validateSpec({ motif: 'lotus', grid: M.GRID_MAX });
  assert.ok(M.drawnCellCount(dense) > M.DETAIL_CELL_LIMIT);
  const sparse = M.validateSpec({ motif: 'lotus', grid: 4 });
  // The detailed lotus draws 8 petals per cell, the simplified one 4.
  const per = (spec) => (M.renderMotifSvg(spec).match(/<path/g) || []).length / M.drawnCellCount(spec);
  assert.ok(per(sparse) > per(dense), `${per(sparse)} vs ${per(dense)}`);
});

test('output size does not grow with the grid — one tile is drawn, not 256 cells', () => {
  const at = (grid) =>
    M.renderMotifSvg(M.validateSpec({ motif: 'dot-grid', grid, repeat: 'mirror', border: 'temple' }), 480).length;
  const small = at(2);
  const big = at(M.GRID_MAX);
  assert.ok(big < small * 1.2, `2 cells: ${small} chars, ${M.GRID_MAX} cells: ${big}`);
  assert.ok(big < 8_000, `${big} chars`);
});

test('a thumbnail at 240 fits inside the 40 KB column cap', () => {
  for (const motif of M.MOTIFS) {
    const svg = M.renderMotifSvg(M.validateSpec({ motif, grid: M.GRID_MAX, repeat: 'mirror', border: 'temple' }), 240);
    assert.ok(Buffer.byteLength(svg, 'utf8') < 40_000, `${motif}: ${Buffer.byteLength(svg, 'utf8')} bytes`);
  }
});

// -------------------------------------------------------------- the palettes

test('every committed palette is real hex and has its name in all four dictionaries', () => {
  const dicts = ['en', 'hi', 'or', 'te'].map((lang) => [lang, readFileSync(`src/lib/i18n/${lang}.ts`, 'utf8')]);
  for (const palette of M.PALETTES) {
    assert.ok(palette.colours.length >= M.PALETTE_MIN, palette.key);
    for (const colour of [...palette.colours, palette.background]) {
      assert.ok(M.HEX.test(colour), `${palette.key}: ${colour}`);
    }
    for (const [lang, src] of dicts) {
      assert.ok(new RegExp(`^  ${palette.labelKey}: "`, 'm').test(src), `${lang} missing ${palette.labelKey}`);
    }
  }
});

test('every motif has its name in all four dictionaries', () => {
  const dicts = ['en', 'hi', 'or', 'te'].map((lang) => [lang, readFileSync(`src/lib/i18n/${lang}.ts`, 'utf8')]);
  for (const motif of M.MOTIFS) {
    const key = `motif_${motif.replace(/-/g, '_')}`;
    for (const [lang, src] of dicts) {
      assert.ok(new RegExp(`^  ${key}: "`, 'm').test(src), `${lang} missing ${key}`);
    }
  }
});

if (failures > 0) {
  console.log(`\n${failures} of ${checks} motif checks failed`);
  process.exit(1);
}
console.log(`motifSpec: all ${checks} checks passed`);
