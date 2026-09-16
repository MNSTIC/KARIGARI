"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Language } from "@/lib/translations";
import {
  MAX_RECORDING_MS,
  RECOGNIZER_LANG,
  getRecognizer,
  pickRecorderMime,
  recognizerAvailable,
  type SpeechRecognitionLike,
} from "@/lib/speechCapture";

/**
 * Hold-to-speak for a form, on the shared speech primitives.
 *
 * Path A, the browser's own recognizer, wherever it knows the language: no
 * server round trip to hear, and it works with no AI key at all. Path B, the
 * recorded clip, for Odia and for browsers without a recognizer — the caller
 * sends it to a route that transcribes it with `transcribeAudio()`.
 *
 * The hook only hears. What was said is handed to `onTranscript` or `onAudio`;
 * it never fills a field or saves anything itself.
 */

export type SpeechCaptureError = "mic_denied" | "no_speech" | "no_mic" | "unsupported" | "failed";

export function useSpeechCapture({
  language,
  onTranscript,
  onAudio,
}: {
  language: Language;
  onTranscript: (text: string) => void;
  onAudio: (audio: Blob, mimeType: string) => void;
}) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<SpeechCaptureError | null>(null);
  /** Unknown until mounted: SSR has no `window`, and guessing would mismatch hydration. */
  const [supported, setSupported] = useState<boolean | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finalRef = useRef("");

  // Latest callbacks in refs, so `start` keeps a stable identity.
  const onTranscriptRef = useRef(onTranscript);
  const onAudioRef = useRef(onAudio);
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
    onAudioRef.current = onAudio;
  }, [onTranscript, onAudio]);

  useEffect(() => {
    const kickoff = setTimeout(() => {
      setSupported(recognizerAvailable() || typeof MediaRecorder !== "undefined");
    }, 0);
    return () => clearTimeout(kickoff);
  }, []);

  const releaseMic = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (autoStopRef.current) {
      clearTimeout(autoStopRef.current);
      autoStopRef.current = null;
    }
  }, []);

  // Never leave the microphone or a recognizer live after the page is gone.
  useEffect(
    () => () => {
      releaseMic();
      recognitionRef.current?.abort();
      recognitionRef.current = null;
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    },
    [releaseMic]
  );

  const startRecording = useCallback(async () => {
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("unsupported");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickRecorderMime();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const type = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        releaseMic();
        setListening(false);
        // An empty clip means nothing was said — say nothing back.
        if (blob.size > 0) onAudioRef.current(blob, type);
      };

      recorder.start();
      setListening(true);
      autoStopRef.current = setTimeout(() => {
        if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      }, MAX_RECORDING_MS);
    } catch (err) {
      console.warn("[speech] microphone unavailable:", (err as Error)?.message);
      releaseMic();
      setListening(false);
      setError((err as Error)?.name === "NotFoundError" ? "no_mic" : "mic_denied");
    }
  }, [releaseMic]);

  const start = useCallback(() => {
    setError(null);
    setInterim("");
    const recognizerLang = RECOGNIZER_LANG[language];
    const recognition = recognizerLang && recognizerAvailable() ? getRecognizer() : null;
    if (!recognition || !recognizerLang) {
      void startRecording();
      return;
    }

    recognitionRef.current = recognition;
    finalRef.current = "";
    recognition.lang = recognizerLang;
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setListening(true);
    recognition.onresult = (event) => {
      let live = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const chunk = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalRef.current += chunk;
        else live += chunk;
      }
      setInterim(live);
    };
    recognition.onerror = (event) => {
      setListening(false);
      setInterim("");
      switch (event.error) {
        case "not-allowed":
        case "service-not-allowed":
          setError("mic_denied");
          break;
        case "no-speech":
          setError("no_speech");
          break;
        case "audio-capture":
          setError("no_mic");
          break;
        case "language-not-supported":
          recognitionRef.current = null;
          void startRecording();
          break;
        case "aborted":
          break;
        default:
          setError("failed");
      }
    };
    recognition.onend = () => {
      setListening(false);
      setInterim("");
      recognitionRef.current = null;
      const said = finalRef.current.trim();
      if (said) onTranscriptRef.current(said);
    };

    try {
      recognition.start();
    } catch (err) {
      console.warn("[speech] recognizer failed to start:", (err as Error)?.message);
      recognitionRef.current = null;
      void startRecording();
    }
  }, [language, startRecording]);

  const stop = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }
    if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
  }, []);

  return { listening, interim, error, supported, start, stop };
}
