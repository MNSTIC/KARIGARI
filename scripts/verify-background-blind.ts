/**
 * Live check that the authenticity comparator is background-blind.
 *
 *     npx tsx --env-file=.env scripts/verify-background-blind.ts
 *
 * Spends 3 Gemini requests. Builds its fixtures from seed photos:
 *
 *   T1a  the piece's camera frame           vs  the same piece photographed in an
 *                                               unrelated setting (another seed
 *                                               photo as the surface, tilted,
 *                                               smaller, under a warm bulb)
 *   T1b  the piece on a studio-white look   vs  that same real-setting photo
 *   T2   the piece in setting S             vs  a DIFFERENT piece in the SAME setting S
 *
 * Passes when T1a and T1b are matches and T2 is not — i.e. the verdict follows
 * the product, never the background. Runs the real `compareProductPhotos()`, so
 * the prompt tested is exactly the one production sends.
 *
 * Exit codes: 0 pass · 1 a wrong verdict · 2 inconclusive (Gemini unavailable,
 * so the fallback answered — its 98% is not a judgement and proves nothing).
 */

import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { compareProductPhotos, type PhotoComparison } from '../src/lib/buyerVerify';

const SEED = path.join(process.cwd(), 'public/seed');
const dataUrl = (buf: Buffer, mime = 'image/jpeg') => `data:${mime};base64,${buf.toString('base64')}`;

async function cutout(file: string): Promise<Buffer> {
  const { removeBackground } = await import('@imgly/background-removal-node');
  const input = await sharp(fs.readFileSync(file)).resize(1024, 1024, { fit: 'inside' }).jpeg({ quality: 85 }).toBuffer();
  const blob = await removeBackground(new Blob([new Uint8Array(input)], { type: 'image/jpeg' }), {
    model: 'medium',
    output: { format: 'image/png' },
  });
  return Buffer.from(await blob.arrayBuffer());
}

async function main() {
  const pieceA = path.join(SEED, 'bidriware/2.jpg');
  const pieceB = path.join(SEED, 'bidriware/4.jpg'); // a different bidriware piece
  const surface = path.join(SEED, 'sambalpuri/2.jpg'); // an unrelated real setting

  console.log('Preparing fixtures (two background removals)…');
  const [cutA, cutB] = [await cutout(pieceA), await cutout(pieceB)];
  const frameA = await sharp(fs.readFileSync(pieceA)).resize(1280, 1280, { fit: 'inside' }).jpeg({ quality: 80 }).toBuffer();
  const meta = await sharp(cutA).metadata();
  const studioA = await sharp({ create: { width: meta.width ?? 800, height: meta.height ?? 800, channels: 3, background: '#FFFFFF' } })
    .composite([{ input: cutA }])
    .jpeg({ quality: 90 })
    .toBuffer();

  const scene = await sharp(fs.readFileSync(surface)).resize(1200, 900, { fit: 'cover' }).modulate({ brightness: 0.85 }).tint({ r: 255, g: 214, b: 160 }).toBuffer();
  const inScene = async (cut: Buffer) => {
    const piece = await sharp(cut)
      .rotate(7, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .resize(620, 620, { fit: 'inside' })
      .modulate({ brightness: 0.88 })
      .tint({ r: 255, g: 220, b: 170 })
      .png()
      .toBuffer();
    return sharp(scene).composite([{ input: piece, left: 310, top: 150 }]).jpeg({ quality: 75 }).toBuffer();
  };
  const sceneA = await inScene(cutA);
  const sceneB = await inScene(cutB);

  const cases: { name: string; expectMatch: boolean; run: () => Promise<PhotoComparison> }[] = [
    { name: 'T1a camera frame vs same piece, unrelated setting', expectMatch: true, run: () => compareProductPhotos(dataUrl(frameA), dataUrl(sceneA)) },
    { name: 'T1b studio-white look vs same piece, unrelated setting', expectMatch: true, run: () => compareProductPhotos(dataUrl(studioA), dataUrl(sceneA)) },
    { name: 'T2  same setting, different piece', expectMatch: false, run: () => compareProductPhotos(dataUrl(sceneA), dataUrl(sceneB)) },
  ];

  let wrong = 0;
  let inconclusive = 0;
  for (const c of cases) {
    const r = await c.run();
    const ok = r.scoredBy === 'gemini' && r.isMatch === c.expectMatch;
    if (r.scoredBy !== 'gemini') inconclusive += 1;
    else if (!ok) wrong += 1;
    const verdict = r.scoredBy !== 'gemini' ? 'INCONCLUSIVE' : ok ? 'PASS' : 'FAIL';
    console.log(`${verdict.padEnd(12)} ${c.name} — score ${r.similarityScore}, match ${r.isMatch} (${r.scoredBy}) — ${r.reasoning.slice(0, 140)}`);
  }
  process.exitCode = wrong ? 1 : inconclusive ? 2 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
