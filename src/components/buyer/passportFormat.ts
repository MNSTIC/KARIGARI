/**
 * Formatting shared by the buyer passport components.
 *
 * Dates are pinned to en-IN and Asia/Kolkata, the same `STAMP_FORMAT` the QR
 * page has always used: this page is server-rendered, and a date formatted in
 * the server's zone and again in the visitor's would throw a hydration
 * mismatch.
 */

export const PASSPORT_STAMP: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
};

export const PASSPORT_DAY: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Kolkata",
};

export function passportStamp(iso: string): string {
  return `${new Date(iso).toLocaleString("en-IN", PASSPORT_STAMP)} IST`;
}

export function passportDay(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", PASSPORT_DAY);
}

export function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.split(`{${key}}`).join(String(value)), template);
}

/** Stored voice languages ("Odia") → an i18n key, when there is one. */
const LANGUAGE_KEYS: Record<string, string> = {
  english: "lang_name_english",
  hindi: "lang_name_hindi",
  odia: "lang_name_odia",
  oriya: "lang_name_odia",
  telugu: "lang_name_telugu",
  gujarati: "lang_name_gujarati",
  bengali: "lang_name_bengali",
  tamil: "lang_name_tamil",
  marathi: "lang_name_marathi",
  kannada: "lang_name_kannada",
  malayalam: "lang_name_malayalam",
  punjabi: "lang_name_punjabi",
  urdu: "lang_name_urdu",
  assamese: "lang_name_assamese",
};

/** The language name in the reader's language; an unknown one is shown as stored. */
export function languageName(stored: string, t: (key: string) => string): string {
  const key = LANGUAGE_KEYS[stored.trim().toLowerCase()];
  return key ? t(key) : stored;
}
