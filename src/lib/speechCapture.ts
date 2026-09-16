import type { Language } from "@/lib/translations";

/**
 * The browser speech primitives, shared.
 *
 * These were private to `VoiceOnboarding.tsx`. The offline sale log needs the
 * same two paths — the browser's own recognizer where it knows the language,
 * recorded audio for the server to transcribe where it does not — so they live
 * here once rather than being copied into a third recorder.
 */

/** Hard stop on recording length: keeps the upload small and the reply fast. */
export const MAX_RECORDING_MS = 20_000;

/**
 * Which app language the browser's own speech recognizer can handle.
 *
 * Chrome's recognizer ships no Odia (`or-IN`) voice model. Falling back to the
 * Hindi recognizer would transcribe Odia speech as Hindi-shaped nonsense, so
 * Odia keeps the Gemini audio path, which handles it natively. Everything else
 * is transcribed in the browser: instant, free, and it works when Gemini's
 * daily quota is gone.
 */
export const RECOGNIZER_LANG: Record<Language, string | null> = {
  en: "en-IN",
  hi: "hi-IN",
  te: "te-IN",
  or: null,
};

export interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

export interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}

function recognizerCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

/** Availability check that does NOT construct a recognizer. */
export function recognizerAvailable(): boolean {
  return recognizerCtor() !== null;
}

export function getRecognizer(): SpeechRecognitionLike | null {
  const Ctor = recognizerCtor();
  return Ctor ? new Ctor() : null;
}

/** First container the browser supports, in the order Gemini handles best. */
export function pickRecorderMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  return candidates.find((m) => MediaRecorder.isTypeSupported(m));
}
