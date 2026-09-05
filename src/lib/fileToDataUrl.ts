/**
 * Turning a picked file into the data URL this app stores everywhere.
 *
 * There is no upload bucket in this deployment: photos, bills and QR captures
 * all live as base64 data URLs on their Postgres row. That makes the size cap
 * the important part — a 12 MP phone photo is several megabytes of base64 and
 * would bloat every row that carries it.
 *
 * One constant, one reader, imported by every surface that accepts a file, so
 * the ceiling the UI enforces is the ceiling the API enforces.
 */

/** Hard ceiling for any single stored upload. Mirrored by the API validators. */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

/** Human-facing size, for copy that has to name the limit. */
export const MAX_UPLOAD_LABEL = "2 MB";

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Byte length of a base64 data URL's payload, without decoding it. */
export function dataUrlBytes(dataUrl: string): number {
  const payload = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return Math.floor((payload.length * 3) / 4);
}
