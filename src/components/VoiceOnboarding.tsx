"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLanguage, type Language } from "@/lib/translations";
import { AlertTriangle, Loader2, Mic, Sparkles, Volume2, VolumeX, X } from "lucide-react";

/** Hard stop on recording length: keeps the upload small and the reply fast. */
const MAX_RECORDING_MS = 20_000;

/**
 * Which app language the browser's own speech recognizer can handle.
 *
 * Chrome's recognizer ships no Odia (`or-IN`) voice model. Falling back to the
 * Hindi recognizer would transcribe Odia speech as Hindi-shaped nonsense, so
 * Odia keeps the Gemini audio path, which handles it natively. Everything else
 * is transcribed in the browser: instant, free, and it works when Gemini's
 * daily quota is gone.
 */
const RECOGNIZER_LANG: Record<Language, string | null> = {
  en: "en-IN",
  hi: "hi-IN",
  te: "te-IN",
  or: null,
};

interface SpeechRecognitionLike {
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

interface SpeechRecognitionEventLike {
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
function recognizerAvailable(): boolean {
  return recognizerCtor() !== null;
}

function getRecognizer(): SpeechRecognitionLike | null {
  const Ctor = recognizerCtor();
  return Ctor ? new Ctor() : null;
}

/** First container the browser supports, in the order Gemini handles best. */
function pickRecorderMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  return candidates.find((m) => MediaRecorder.isTypeSupported(m));
}

export function VoiceOnboarding({
  artisanName,
  currentRoute,
}: {
  artisanName?: string;
  currentRoute?: string;
}) {
  const { language } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const [transcript, setTranscript] = useState("");
  /** Words the recognizer is still revising — shown greyed while speaking. */
  const [interim, setInterim] = useState("");
  const [responseMsg, setResponseMsg] = useState("");
  const [statusMsg, setStatusMsg] = useState("");
  /**
   * Set when the answer did not come from the model: a rules answer, a mic
   * problem, or an outright failure. Rendered as a warning strip so a degraded
   * answer can never pass for the real thing.
   */
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const finalTranscriptRef = useRef("");
  const gotResultRef = useRef(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPlaying = useCallback(() => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      setIsPlaying(false);
    }
  }, []);

  const speakText = useCallback(
    (text: string) => {
      if (typeof window === "undefined" || !window.speechSynthesis) return;
      stopPlaying();

      const utterance = new SpeechSynthesisUtterance(text);
      // en-IN on purpose: Windows and Android usually ship no Odia or Telugu
      // voice, but the Indian English voice reads romanized text convincingly.
      utterance.lang = "en-IN";
      const voices = window.speechSynthesis.getVoices();
      const indianVoice = voices.find((v) => v.lang === "en-IN" || v.lang === "hi-IN");
      if (indianVoice) utterance.voice = indianVoice;
      utterance.rate = 0.9;
      utterance.pitch = 1.0;
      utterance.onstart = () => setIsPlaying(true);
      utterance.onend = () => setIsPlaying(false);
      utterance.onerror = () => setIsPlaying(false);

      window.speechSynthesis.speak(utterance);
    },
    [stopPlaying]
  );

  const releaseMic = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (autoStopRef.current) {
      clearTimeout(autoStopRef.current);
      autoStopRef.current = null;
    }
  }, []);

  const cleanup = useCallback(() => {
    releaseMic();
    recognitionRef.current?.abort();
    recognitionRef.current = null;
  }, [releaseMic]);

  // Never leave the microphone or the recognizer live after the panel is gone.
  useEffect(() => cleanup, [cleanup]);

  /** Shared response handling for both the transcript and the audio path. */
  const applyResponse = useCallback(
    (data: { success?: boolean; reply?: string; transcript?: string | null; notice?: string; error?: string }) => {
      setStatusMsg("");
      if (!data?.success || !data.reply) {
        setErrorMsg(data?.error || (t.failed[language] ?? t.failed.en));
        return;
      }
      if (data.transcript) setTranscript(data.transcript);
      setNotice(data.notice ?? null);
      setResponseMsg(data.reply);
      speakText(data.reply);
    },
    [language, speakText]
  );

  const post = useCallback(
    async (payload: Record<string, unknown>) => {
      setIsProcessing(true);
      setStatusMsg(t.thinking[language] ?? t.thinking.en);
      try {
        const res = await fetch("/api/voice-assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, language, artisanName, currentRoute }),
        });

        if (res.status === 401) {
          setStatusMsg("");
          setErrorMsg(t.signedOut[language] ?? t.signedOut.en);
          return;
        }
        applyResponse(await res.json());
      } catch (e) {
        console.error("Voice assistant request failed", e);
        setStatusMsg("");
        setErrorMsg(t.offline[language] ?? t.offline.en);
      } finally {
        setIsProcessing(false);
      }
    },
    [applyResponse, artisanName, currentRoute, language]
  );

  // ---------------------------------------------------------------------
  // Path B: record audio and let Gemini transcribe it. Used for Odia, and
  // for any browser without the Web Speech API.
  // ---------------------------------------------------------------------
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = pickRecorderMime();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        const type = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(audioChunksRef.current, { type });
        releaseMic();
        // Empty blob means they never actually spoke — say nothing.
        if (blob.size === 0) {
          setStatusMsg("");
          return;
        }
        const base64Audio: string = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
        await post({ audio: base64Audio, mimeType: type });
      };

      recorder.start();
      setIsListening(true);
      setStatusMsg(t.listening[language] ?? t.listening.en);
      autoStopRef.current = setTimeout(() => {
        if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
        setIsListening(false);
      }, MAX_RECORDING_MS);
    } catch (err) {
      console.error("Mic error:", err);
      setStatusMsg("");
      setIsListening(false);
      setErrorMsg(t.micDenied[language] ?? t.micDenied.en);
    }
  }, [language, post, releaseMic]);

  // ---------------------------------------------------------------------
  // Path A: the browser transcribes. Primary path — no Gemini quota spent on
  // hearing, and the artisan sees their own words as they speak.
  // ---------------------------------------------------------------------
  const startRecognition = useCallback(
    (recognizerLang: string) => {
      const recognition = getRecognizer();
      if (!recognition) {
        void startRecording();
        return;
      }

      recognitionRef.current = recognition;
      finalTranscriptRef.current = "";
      gotResultRef.current = false;

      recognition.lang = recognizerLang;
      recognition.interimResults = true;
      recognition.continuous = false;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        setIsListening(true);
        setStatusMsg(t.listening[language] ?? t.listening.en);
      };

      recognition.onresult = (event) => {
        gotResultRef.current = true;
        let live = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const chunk = event.results[i][0].transcript;
          if (event.results[i].isFinal) finalTranscriptRef.current += chunk;
          else live += chunk;
        }
        setInterim(live);
        if (finalTranscriptRef.current) setTranscript(finalTranscriptRef.current);
      };

      recognition.onerror = (event) => {
        console.error("Speech recognition error:", event.error);
        setIsListening(false);
        setInterim("");
        setStatusMsg("");

        switch (event.error) {
          case "not-allowed":
          case "service-not-allowed":
            setErrorMsg(t.micDenied[language] ?? t.micDenied.en);
            break;
          case "no-speech":
            setErrorMsg(t.noSpeech[language] ?? t.noSpeech.en);
            break;
          case "audio-capture":
            setErrorMsg(t.noMic[language] ?? t.noMic.en);
            break;
          case "language-not-supported":
            // The recognizer cannot handle this language — let Gemini hear it.
            setErrorMsg(null);
            void startRecording();
            break;
          case "aborted":
            break;
          default:
            setErrorMsg(t.offline[language] ?? t.offline.en);
        }
      };

      recognition.onend = () => {
        setIsListening(false);
        setInterim("");
        recognitionRef.current = null;
        const said = finalTranscriptRef.current.trim();
        if (said) void post({ transcript: said });
        else if (gotResultRef.current) setStatusMsg("");
      };

      try {
        recognition.start();
      } catch (err) {
        console.error("Speech recognition failed to start:", err);
        void startRecording();
      }
    },
    [language, post, startRecording]
  );

  const startListening = () => {
    stopPlaying();
    setTranscript("");
    setInterim("");
    setResponseMsg("");
    setNotice(null);
    setErrorMsg(null);
    setIsOpen(true);

    const recognizerLang = RECOGNIZER_LANG[language];
    if (recognizerLang && recognizerAvailable()) {
      startRecognition(recognizerLang);
      return;
    }
    // No recognizer for this language (Odia), or none in this browser at all.
    // Either way the audio path can still hear them — unless the browser has
    // no MediaRecorder either, and then there is nothing left to try.
    if (typeof MediaRecorder === "undefined") {
      setErrorMsg(t.unsupported[language] ?? t.unsupported.en);
      return;
    }
    void startRecording();
  };

  const stopListening = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      setStatusMsg(t.thinking[language] ?? t.thinking.en);
      return;
    }
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    setIsListening(false);
    setStatusMsg(t.thinking[language] ?? t.thinking.en);
  };

  const closePanel = () => {
    if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
    cleanup();
    stopPlaying();
    setIsListening(false);
    setIsOpen(false);
  };

  return (
    <>
      <button
        onClick={() => (isOpen ? closePanel() : setIsOpen(true))}
        aria-label={isOpen ? "Close voice assistant" : "Open voice assistant"}
        aria-expanded={isOpen}
        className="fixed bottom-6 right-6 z-[100] w-14 h-14 bg-gradient-to-r from-primary to-green-600 rounded-full shadow-2xl flex items-center justify-center text-white hover:scale-105 transition-transform"
      >
        <Mic size={24} />
      </button>

      {isOpen && (
        <div className="fixed bottom-24 right-6 w-80 max-w-[calc(100vw-3rem)] bg-white rounded-3xl shadow-2xl border border-gray-100 z-[100] overflow-hidden flex flex-col animate-fade-in-up">
          <div className="bg-[#14211B] p-4 text-white flex justify-between items-center">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
                <Sparkles size={16} className="text-green-300" />
              </div>
              <div>
                <h3 className="font-bold text-sm">Karigari Assistant</h3>
                <p className="text-xs text-white/70">{t.langLabel[language] ?? t.langLabel.en}</p>
              </div>
            </div>
            <button
              onClick={closePanel}
              aria-label="Close assistant"
              className="text-white/70 hover:text-white"
            >
              <X size={16} />
            </button>
          </div>

          <div className="p-5 h-48 bg-gray-50 flex flex-col justify-end">
            <div className="space-y-3 max-h-full overflow-y-auto">
              {(transcript || interim) && (
                <div className="bg-white p-3 rounded-2xl rounded-tr-none text-sm shadow-sm border border-gray-100 w-11/12 ml-auto">
                  <span className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-0.5">
                    {t.youSaid[language] ?? t.youSaid.en}
                  </span>
                  <span className="text-gray-800">{transcript}</span>
                  {interim && <span className="text-gray-400"> {interim}</span>}
                </div>
              )}

              {statusMsg && (
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  {isProcessing ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
                    </span>
                  )}
                  {statusMsg}
                </div>
              )}

              {errorMsg && (
                <div
                  role="alert"
                  className="bg-amber-50 border border-amber-200 p-3 rounded-2xl text-sm text-amber-900 shadow-sm w-11/12 flex gap-2"
                >
                  <AlertTriangle size={14} className="shrink-0 mt-0.5 text-amber-600" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {notice && (
                <div
                  role="status"
                  className="bg-amber-50 border border-amber-200 px-3 py-2 rounded-xl text-[11px] text-amber-900 w-11/12 flex gap-2"
                >
                  <AlertTriangle size={12} className="shrink-0 mt-0.5 text-amber-600" />
                  <span>{notice}</span>
                </div>
              )}

              {responseMsg && (
                <div className="bg-[#DCEBE0] p-3 rounded-2xl rounded-tl-none text-sm text-[#14211B] shadow-sm w-11/12">
                  {responseMsg}
                </div>
              )}
            </div>
          </div>

          <div className="p-4 bg-white border-t border-gray-100 flex items-center justify-center gap-4">
            {isListening ? (
              <button
                onClick={stopListening}
                aria-label="Stop recording"
                className="w-14 h-14 bg-red-500 rounded-full flex items-center justify-center text-white shadow-md animate-pulse"
              >
                <span className="w-4 h-4 bg-white rounded-[2px]" />
              </button>
            ) : (
              <button
                onClick={startListening}
                disabled={isProcessing}
                aria-label="Start recording"
                className="w-14 h-14 bg-[#24332C] hover:bg-[#14211B] disabled:opacity-50 rounded-full flex items-center justify-center text-white shadow-md transition-colors"
              >
                <Mic size={24} />
              </button>
            )}

            {isPlaying && (
              <button
                onClick={stopPlaying}
                aria-label="Stop playback"
                className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center text-gray-600 hover:bg-gray-200"
              >
                <VolumeX size={16} />
              </button>
            )}

            {!isPlaying && responseMsg && (
              <button
                onClick={() => speakText(responseMsg)}
                aria-label="Play answer again"
                className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center text-gray-600 hover:bg-gray-200"
              >
                <Volume2 size={16} />
              </button>
            )}
          </div>

          {!isListening && !transcript && !responseMsg && !errorMsg && (
            <p className="text-center text-xs text-gray-400 pb-3 -mt-2">
              {t.tip[language] ?? t.tip.en}
            </p>
          )}
        </div>
      )}
    </>
  );
}

/** Panel copy. Kept local because these strings never appear anywhere else. */
const t: Record<string, Record<string, string>> = {
  tip: {
    en: "Tap here and speak...",
    hi: "यहां टैप करें और बोलें...",
    or: "ଏଠାରେ ଟ୍ୟାପ୍ କରନ୍ତୁ ଏବଂ କୁହନ୍ତୁ...",
    te: "ఇక్కడ నొక్కండి మరియు మాట్లాడండి...",
  },
  youSaid: {
    en: "You said",
    hi: "आपने कहा",
    or: "ଆପଣ କହିଲେ",
    te: "మీరు చెప్పారు",
  },
  listening: {
    en: "Listening...",
    hi: "सुन रहा हूँ...",
    or: "ଶୁଣୁଛି...",
    te: "వింటున్నాను...",
  },
  thinking: {
    en: "Thinking...",
    hi: "सोच रहा हूँ...",
    or: "ଭାବୁଛି...",
    te: "ఆలోచిస్తున్నాను...",
  },
  failed: {
    en: "Sorry, I could not understand that. Please try again.",
    hi: "क्षमा करें, मैं समझ नहीं पाया। कृपया फिर से बोलें।",
    or: "କ୍ଷମା କରନ୍ତୁ, ମୁଁ ବୁଝି ପାରିଲି ନାହିଁ। ଦୟାକରି ପୁଣି କୁହନ୍ତୁ।",
    te: "క్షమించండి, నాకు అర్థం కాలేదు. దయచేసి మళ్ళీ చెప్పండి.",
  },
  offline: {
    en: "Could not reach the assistant. Check your connection.",
    hi: "सहायक से संपर्क नहीं हो सका। अपना कनेक्शन जांचें।",
    or: "ସହାୟକଙ୍କ ସହ ଯୋଗାଯୋଗ ହୋଇପାରିଲା ନାହିଁ। ସଂଯୋଗ ଯାଞ୍ଚ କରନ୍ତୁ।",
    te: "సహాయకుడిని చేరుకోలేకపోయాము. మీ కనెక్షన్‌ను తనిఖీ చేయండి.",
  },
  micDenied: {
    en: "Microphone permission is blocked. Allow mic access in your browser, then tap the microphone again.",
    hi: "माइक्रोफ़ोन की अनुमति अवरुद्ध है। ब्राउज़र में अनुमति दें, फिर माइक्रोफ़ोन दबाएँ।",
    or: "ମାଇକ୍ରୋଫୋନ୍ ଅନୁମତି ଅବରୋଧିତ। ବ୍ରାଉଜରରେ ଅନୁମତି ଦିଅନ୍ତୁ, ତା'ପରେ ମାଇକ୍ରୋଫୋନ୍ ତିପନ୍ତୁ।",
    te: "మైక్రోఫోన్ అనుమతి నిరోధించబడింది. బ్రౌజర్‌లో అనుమతించి, మళ్ళీ మైక్రోఫోన్ నొక్కండి.",
  },
  noSpeech: {
    en: "I did not catch any speech. Tap the microphone and speak a little louder.",
    hi: "मुझे कोई आवाज़ नहीं मिली। माइक्रोफ़ोन दबाकर थोड़ा तेज़ बोलिए।",
    or: "ମୁଁ କୌଣସି ସ୍ୱର ପାଇଲି ନାହିଁ। ମାଇକ୍ରୋଫୋନ୍ ତିପି ଟିକେ ଜୋରରେ କୁହନ୍ତୁ।",
    te: "నాకు ఏ మాట వినిపించలేదు. మైక్రోఫోన్ నొక్కి కొంచెం గట్టిగా మాట్లాడండి.",
  },
  noMic: {
    en: "No microphone was found on this device.",
    hi: "इस डिवाइस पर कोई माइक्रोफ़ोन नहीं मिला।",
    or: "ଏହି ଡିଭାଇସରେ କୌଣସି ମାଇକ୍ରୋଫୋନ୍ ମିଳିଲା ନାହିଁ।",
    te: "ఈ పరికరంలో మైక్రోఫోన్ కనిపించలేదు.",
  },
  unsupported: {
    en: "Voice input is not supported in this browser — please try Chrome.",
    hi: "इस ब्राउज़र में वॉइस इनपुट काम नहीं करता — कृपया Chrome आज़माएँ।",
    or: "ଏହି ବ୍ରାଉଜରରେ ଭଏସ୍ ଇନପୁଟ୍ କାମ କରେ ନାହିଁ — ଦୟାକରି Chrome ବ୍ୟବହାର କରନ୍ତୁ।",
    te: "ఈ బ్రౌజర్‌లో వాయిస్ ఇన్‌పుట్ పని చేయదు — దయచేసి Chrome వాడండి.",
  },
  signedOut: {
    en: "Your session expired. Please sign in again.",
    hi: "आपका सत्र समाप्त हो गया। कृपया फिर से साइन इन करें।",
    or: "ଆପଣଙ୍କ ସେସନ୍ ଶେଷ ହୋଇଛି। ଦୟାକରି ପୁଣି ସାଇନ୍ ଇନ୍ କରନ୍ତୁ।",
    te: "మీ సెషన్ ముగిసింది. దయచేసి మళ్ళీ సైన్ ఇన్ చేయండి.",
  },
  langLabel: { en: "English", hi: "हिंदी", or: "ଓଡ଼ିଆ", te: "తెలుగు" },
};
