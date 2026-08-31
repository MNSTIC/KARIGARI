"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { Mic, UploadCloud, FileText, ArrowRight, X, Sparkles, CheckCircle2, Camera, Trash2, ShieldCheck, Globe, AlertTriangle, Pencil, IndianRupee, TrendingUp, Loader2, RefreshCw } from "lucide-react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/lib/translations";
import { estimateCraftValuation, formatRupees } from "@/lib/pricing";
import { downscaleImage, enhanceProductPhoto } from "@/lib/imageEnhance";

interface CaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Message = { id: string; role: "assistant" | "user"; text: string; isProcessing?: boolean };

/**
 * What the capture API is sent when voice extraction produced nothing usable.
 * The price quote in Step 3 is computed from the same values, so the artisan is
 * always shown the band that will actually be persisted on their item.
 */
const FALLBACK_CRAFT_TYPE = "Crafted Item";
const FALLBACK_LABOR_DAYS = 9;
const FALLBACK_MATERIAL_COST = 2800;

/** In-app replacement for every browser `alert()` this modal used to fire. */
type Notice = { tone: "error" | "warning"; title: string; body?: string };

/**
 * BCP-47 tags for the live preview. Indian variants matter: `hi-IN` recognises
 * Indian Hindi far better than `hi`. Odia has patchy browser support, which is
 * exactly why Whisper remains the authority — a missing preview costs nothing.
 */
const SPEECH_LANGS: Record<string, string> = {
  en: "en-IN",
  hi: "hi-IN",
  te: "te-IN",
  or: "or-IN",
};

export function CaptureModal({ isOpen, onClose }: CaptureModalProps) {
  const { t, language } = useLanguage();
  const [step, setStep] = useState(1);
  const [isListening, setIsListening] = useState(false);
  const [isProcessed, setIsProcessed] = useState(false);
  const [inputText, setInputText] = useState("");
  const [isProcessingAI, setIsProcessingAI] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);

  /**
   * Browser SpeechRecognition runs alongside MediaRecorder purely so the
   * artisan sees their words appear as they speak. Whisper is still the
   * authority — it handles Odia and Telugu far better than any handset engine —
   * so this transcript is a preview, and the server's `originalTranscript`
   * replaces it once the recording is parsed.
   */
  const recognitionRef = useRef<any>(null);
  const liveTranscriptRef = useRef<string>("");
  const [liveTranscript, setLiveTranscript] = useState("");
  /** Id of the user bubble holding the live text, so it can be rewritten. */
  const liveBubbleIdRef = useRef<string | null>(null);
  
  // Chat History
  const [messages, setMessages] = useState<Message[]>([]);

  useEffect(() => {
    if (isOpen) {
      if (messages.length === 0) {
        setMessages([{ id: '1', role: "assistant", text: t('assistant_intro') }]);
      } else if (messages.length > 0 && messages[0].id === '1' && messages[0].text !== t('assistant_intro')) {
        setMessages(prev => [{ ...prev[0], text: t('assistant_intro') }, ...prev.slice(1)]);
      }
    }
  }, [isOpen, t, messages]);
  
  // Form Data extracted from Voice
  const [originalTranscript, setOriginalTranscript] = useState<string>("");
  const [laborDays, setLaborDays] = useState<number>(0);
  const [rawMaterialCost, setRawMaterialCost] = useState<number>(0);
  const [englishDescription, setEnglishDescription] = useState<string>("");
  const [sourceLanguage, setSourceLanguage] = useState<string>("");
  const [craftType, setCraftType] = useState<string>("");
  /** Cost-relevant context the artisan volunteered (loom, thread, handmade...). */
  const [technique, setTechnique] = useState<string | null>(null);

  /**
   * Everything the artisan has said so far in Step 1.
   *
   * Each turn is appended and the WHOLE thing is re-parsed, so "a silk saree"
   * followed by "it took 12 days, pure silk thread" is understood as one
   * complete description. Parsing only the latest message would throw away the
   * craft name the moment they answered the follow-up question.
   */
  const conversationTextRef = useRef<string>("");

  /** Which of product / time / materials the artisan has actually stated. */
  const [facts, setFacts] = useState<{ product: boolean; time: boolean; materials: boolean }>({
    product: false,
    time: false,
    materials: false,
  });
  /** True once at least one parse has run, so the checklist is not shown empty. */
  const [hasParsed, setHasParsed] = useState(false);

  // Step 3 price-setting. Kept as a string so the field can be cleared without
  // snapping back to 0, and so a blank means "use the AI suggestion".
  const [askingPrice, setAskingPrice] = useState<string>("");
  const [priceTouched, setPriceTouched] = useState(false);
  
  // Dual Camera State
  const [images, setImages] = useState<string[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);

  // AI vision verification
  const [isVerifyingVision, setIsVerifyingVision] = useState(false);
  const [isVisionVerified, setIsVisionVerified] = useState(false);
  const [isEnhancingImage, setIsEnhancingImage] = useState(false);
  /** True when the ML cutout actually ran, so the UI can say so honestly. */
  const [backgroundRemoved, setBackgroundRemoved] = useState(false);
  const [ecommerceDescEnglish, setEcommerceDescEnglish] = useState("");
  const [ecommerceDescLocal, setEcommerceDescLocal] = useState("");

  /**
   * Vision rejection is in-app state, not a popup — and it also stops the
   * verification effect from firing again on the same rejected photo.
   */
  const [visionRejected, setVisionRejected] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");

  /** Every other former `alert()` lands here and renders as a banner. */
  const [notice, setNotice] = useState<Notice | null>(null);

  /* --- Dynamic Pricing Assistant (Step 3) ------------------------------- */
  const [priceResearch, setPriceResearch] = useState<{
    recommendedPrice: number;
    floor: number;
    band: { min: number; max: number };
    rationale: string | null;
    clampedToFloor: boolean;
    comparables: { platform: string; title: string; priceMin: number; priceMax: number; note: string }[];
  } | null>(null);
  const [priceResearchLoading, setPriceResearchLoading] = useState(false);
  const [priceResearchError, setPriceResearchError] = useState<string | null>(null);

  const [isCreatingDraft, setIsCreatingDraft] = useState(false);
  const [createdItemId, setCreatedItemId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isProcessingAI]);

  // AI Vision Verification & Enhancement
  useEffect(() => {
    // `visionRejected` is part of the guard on purpose: without it a rejected
    // photo re-triggers this effect forever, because the effect itself flips
    // isVerifyingVision back to false.
    if (images.length > 0 && !isVisionVerified && !isVerifyingVision && !visionRejected && step === 2) {
      setIsVerifyingVision(true);
      setIsEnhancingImage(true);

      // Real work, not a timer: cut the background out and enhance the photo,
      // then verify THAT image and save it. Falls back to the enhanced original
      // if the ML model is slow or unsupported, so capture never stalls.
      enhanceProductPhoto(images[0])
      .then(async (enhanced) => {
        setBackgroundRemoved(enhanced.backgroundRemoved);
        setIsEnhancingImage(false);

        // Compress the enhanced frame before it becomes the stored image, so
        // the cutout/enhancement pass cannot reintroduce a huge payload.
        const stored = await downscaleImage(enhanced.dataUrl);
        if (stored !== images[0]) {
          // The enhanced frame becomes the item's photo, so what the model
          // verifies is exactly what ends up on the listing.
          setImages((prev) => [stored, ...prev.slice(1)]);
        }

        const res = await fetch('/api/items/vision-verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageBase64: stored,
            description: englishDescription,
            targetLanguage: language
          })
        });
        return res.json();
      })
      .then(data => {
        setIsVerifyingVision(false);
        setIsEnhancingImage(false);
        if (data.success && data.data?.isVerified) {
          setIsVisionVerified(true);
          setVisionRejected(false);
          setRejectionReason("");
          // The route returns `descriptionEnglish` / `descriptionLocal`. Reading
          // the old `ecommerceDescription*` names left the listing blank and
          // saved an empty aiGeneratedListing with every item.
          setEcommerceDescEnglish(data.data.descriptionEnglish || englishDescription || "");
          setEcommerceDescLocal(data.data.descriptionLocal || "");
        } else {
          setVisionRejected(true);
          setRejectionReason(
            data.data?.reasoning || data.error || t('vision_rejected_default')
          );
        }
      })
      .catch(err => {
        console.error(err);
        setIsVerifyingVision(false);
        setIsEnhancingImage(false);
        setVisionRejected(true);
        setRejectionReason(t('vision_check_failed'));
      });
    }
  }, [images, isVisionVerified, isVerifyingVision, visionRejected, step, englishDescription, language, t]);

  // The AI valuation the artisan is quoted in Step 3. Same function the capture
  // API runs server-side, so the suggested band is not a second, drifting guess.
  const valuation = useMemo(
    () =>
      estimateCraftValuation(
        craftType || FALLBACK_CRAFT_TYPE,
        laborDays || FALLBACK_LABOR_DAYS,
        rawMaterialCost || FALLBACK_MATERIAL_COST,
        technique
      ),
    [craftType, laborDays, rawMaterialCost, technique]
  );

  // Prefill with the suggested market-mid until the artisan types their own
  // number; after that their choice stands even if the valuation shifts.
  useEffect(() => {
    if (step === 3 && !priceTouched) {
      setAskingPrice(String(Math.round(valuation.standardMarketPrice)));
    }
  }, [step, priceTouched, valuation]);

  const enteredPrice = Number(askingPrice);
  const hasEnteredPrice = askingPrice.trim() !== "" && Number.isFinite(enteredPrice) && enteredPrice > 0;
  const isBelowFairFloor = hasEnteredPrice && enteredPrice < valuation.fairWageFloor;
  const hasValuationInput = laborDays > 0 || rawMaterialCost > 0;

  // Auto create draft on Step 3 completion (Wait for save button)
  const handleSaveUpload = async () => {
    if (isCreatingDraft || createdItemId) return;
    setIsCreatingDraft(true);
    setNotice(null);
    try {
      // The English box is what goes out as the ONDC listing; the artisan's own
      // language version is what the digital passport tells the buyer.
      const englishListing = (ecommerceDescEnglish.trim() || englishDescription.trim());
      const localListing = (ecommerceDescLocal.trim() || originalTranscript.trim());

      const res = await fetch("/api/items/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          craftType: craftType || FALLBACK_CRAFT_TYPE,
          laborDays: laborDays || FALLBACK_LABOR_DAYS,
          rawMaterialCost: rawMaterialCost || FALLBACK_MATERIAL_COST,
          askingPrice: hasEnteredPrice ? enteredPrice : null,
          descriptionOriginal: localListing,
          descriptionEnglish: englishDescription.trim() || englishListing,
          tags: [craftType || "ArtisanCraft"],
          images: images,
          aiGeneratedListing: englishListing
        })
      });

      const data = await res.json();
      if (res.ok && data.item?.id) {
        setCreatedItemId(data.item.id);
        setStep(4); // Use step 4 as the success screen
      } else {
        setNotice({ tone: "error", title: t('save_failed'), body: data.error });
      }
    } catch (e) {
      console.error(e);
      setNotice({ tone: "error", title: t('save_failed'), body: t('network_error_retry') });
    } finally {
      setIsCreatingDraft(false);
    }
  };
  
  /**
   * Send a finished recording to Groq Whisper via /api/items/voice-parse.
   *
   * Replaces the browser's SpeechRecognition, which barely supports Odia or
   * Telugu — the languages most of these artisans actually speak. Whisper runs
   * server-side, so recognition quality no longer depends on the handset.
   */
  const processAudioWithGroq = async (audioBlob: Blob) => {
    // The live bubble already holds whatever the browser heard. Keep it and
    // overwrite it with the server transcript below; only create one here when
    // the browser had no SpeechRecognition to seed it.
    const bubbleId = liveBubbleIdRef.current ?? `voice-${Date.now()}`;
    if (!liveBubbleIdRef.current) {
      liveBubbleIdRef.current = bubbleId;
      setMessages(prev => [
        ...prev,
        { id: bubbleId, role: "user", text: liveTranscriptRef.current || `🎙️ ${t('audio_recorded')}` },
      ]);
    }
    setIsProcessingAI(true);

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setNotice({ tone: "warning", title: t('offline_title'), body: t('offline_audio_body') });
      setIsProcessingAI(false);
      return;
    }

    try {
      const formData = new FormData();
      formData.append("file", audioBlob, "recording.webm");
      // Ask the parser for the description in the artisan's own language too.
      formData.append("language", language);
      // Everything said so far, so this recording is understood as a
      // continuation rather than a replacement.
      if (conversationTextRef.current) {
        formData.append("context", conversationTextRef.current);
      }

      const res = await fetch("/api/items/voice-parse", { method: "POST", body: formData });
      const result = await res.json();

      if (!res.ok || !result?.data) {
        throw new Error(result?.error || "Failed to process audio");
      }

      // The route merged `context` with this turn's transcript; keep the merged
      // text as the running conversation.
      conversationTextRef.current = (result.data.originalTranscript || "").trim();

      // Whisper is the authority: replace the browser's preview with what the
      // server actually understood, so the artisan sees the words the valuation
      // was derived from.
      const spoken = (result.data.originalTranscript || "").trim();
      if (spoken) {
        setMessages(prev => prev.map(m => (m.id === bubbleId ? { ...m, text: spoken } : m)));
      }
      liveBubbleIdRef.current = null;

      applyParse(result.data);
    } catch (err) {
      console.error("Audio processing failed:", err);
      // Keep whatever the browser heard rather than a stale placeholder.
      const heard = liveTranscriptRef.current.trim();
      setMessages(prev =>
        heard
          ? prev.map(m => (m.id === bubbleId ? { ...m, text: heard } : m))
          : prev.filter(m => m.id !== bubbleId)
      );
      liveBubbleIdRef.current = null;

      // In-app banner, never a browser alert — and the typed path still works.
      setNotice({
        tone: "warning",
        title: t('ai_processing_error'),
        body: (err as Error)?.message || t('ai_processing_error_body'),
      });
    } finally {
      setIsProcessingAI(false);
    }
  };

  /**
   * Apply one parse result to Step 1.
   *
   * The gate: `isProcessed` — which is what enables Next — is only set when the
   * artisan has actually stated the product, the time and the materials. The
   * parser always returns numbers (it estimates so the valuation has something
   * to work with), so gating on "did we get a response" let a bare "a silk
   * saree" through carrying invented labour days and material cost.
   */
  const applyParse = (data: any): boolean => {
    const missing: string[] = Array.isArray(data?.missing) ? data.missing : [];

    setFacts({
      product: data?.statedProduct === true,
      time: data?.statedTime === true,
      materials: data?.statedMaterials === true,
    });
    setHasParsed(true);

    // Keep whatever was understood so far — a later turn only adds to it.
    setOriginalTranscript(conversationTextRef.current);
    if (data?.craftType) setCraftType(data.craftType);
    if (data?.englishDescription) setEnglishDescription(data.englishDescription);
    if (typeof data?.laborDays === 'number') setLaborDays(data.laborDays);
    if (typeof data?.rawMaterialCost === 'number') setRawMaterialCost(data.rawMaterialCost);
    if (data?.sourceLanguage) setSourceLanguage(data.sourceLanguage);
    if (data?.technique) setTechnique(data.technique);

    if (missing.length > 0) {
      // Ask for exactly what is missing, in their language, and stay on Step 1.
      const question =
        (typeof data?.followUpQuestion === 'string' && data.followUpQuestion.trim()) ||
        t('provide_missing_hint');
      setMessages((prev) => [
        ...prev,
        { id: `ask-${Date.now()}`, role: 'assistant', text: question },
      ]);
      return false;
    }

    setMessages((prev) => [
      ...prev,
      {
        id: `sum-${Date.now()}`,
        role: 'assistant',
        text:
          `${t('ai_understood')} ${data.craftType} · ${data.laborDays} ${t('days')} · ₹${data.rawMaterialCost}` +
          (data.technique ? ` · ${data.technique}` : ''),
      },
    ]);
    setIsProcessed(true);
    return true;
  };

  /**
   * Estimated comparable prices across platforms.
   *
   * The route is explicit that these are estimates, not scraped listings, and
   * it never recommends below the fair-wage floor. Called on demand from Step 3
   * so an artisan who already knows their price pays no latency for it.
   */
  const runPriceResearch = async () => {
    setPriceResearchLoading(true);
    setPriceResearchError(null);
    try {
      const res = await fetch('/api/items/price-research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          craftType: craftType || FALLBACK_CRAFT_TYPE,
          description: englishDescription,
          laborDays: laborDays || FALLBACK_LABOR_DAYS,
          rawMaterialCost: rawMaterialCost || FALLBACK_MATERIAL_COST,
          language,
        }),
      });
      const data = await res.json();
      if (data?.success) {
        setPriceResearch(data);
      } else {
        setPriceResearchError(data?.error || t('price_research_failed'));
      }
    } catch (e) {
      console.error('Price research failed:', e);
      setPriceResearchError(t('price_research_failed'));
    } finally {
      setPriceResearchLoading(false);
    }
  };

  /**
   * Start the live preview. Never throws: an unsupported browser simply means
   * no preview, and the record -> Whisper path is untouched.
   */
  const startLivePreview = () => {
    if (typeof window === "undefined") return;
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = SPEECH_LANGS[language] || "en-IN";

      recognition.onresult = (event: any) => {
        let text = "";
        for (let i = 0; i < event.results.length; i += 1) {
          text += event.results[i][0].transcript;
        }
        const trimmed = text.trim();
        liveTranscriptRef.current = trimmed;
        setLiveTranscript(trimmed);

        // Rewrite the user's own bubble in place so the words appear as spoken.
        if (liveBubbleIdRef.current) {
          const id = liveBubbleIdRef.current;
          setMessages((prev) =>
            prev.map((m) => (m.id === id ? { ...m, text: trimmed || `🎙️ ${t('listening')}` } : m))
          );
        }
      };

      // A recognition error is not an error for the capture: Whisper still runs.
      recognition.onerror = () => {};

      recognition.start();
      recognitionRef.current = recognition;
    } catch (err) {
      console.warn("Live transcription unavailable:", (err as Error)?.message);
    }
  };

  const stopLivePreview = () => {
    try {
      recognitionRef.current?.stop();
    } catch {
      // Already stopped; nothing to do.
    }
    recognitionRef.current = null;
  };

  const toggleListening = async () => {
    if (isProcessed) return;

    if (isListening && mediaRecorder) {
      mediaRecorder.stop();
      stopLivePreview();
      setIsListening(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      liveTranscriptRef.current = "";
      setLiveTranscript("");

      // Seed the bubble the live text will be written into, so the artisan sees
      // something the instant they start speaking rather than after upload.
      const bubbleId = `live-${Date.now()}`;
      liveBubbleIdRef.current = bubbleId;
      setMessages((prev) => [
        ...prev,
        { id: bubbleId, role: "user", text: `🎙️ ${t('listening')}` },
      ]);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        stopLivePreview();

        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const dropBubble = () => {
          const id = liveBubbleIdRef.current;
          if (id) setMessages((prev) => prev.filter((m) => m.id !== id));
          liveBubbleIdRef.current = null;
        };

        if (audioBlob.size === 0) {
          dropBubble();
          return;
        }
        // A tap-and-release is a few hundred bytes of silence. Tell the artisan
        // to hold the button instead of burning a failed API round trip on it.
        if (audioBlob.size < 4096) {
          dropBubble();
          setNotice({ tone: "warning", title: t('recording_too_short'), body: t('recording_too_short_body') });
          return;
        }
        await processAudioWithGroq(audioBlob);
      };

      recorder.start();
      startLivePreview();
      setMediaRecorder(recorder);
      setIsListening(true);
    } catch (err) {
      console.error("Mic access denied or unavailable:", err);
      setNotice({ tone: "warning", title: t('mic_error'), body: t('mic_error_body') });
    }
  };

  const processWithAI = async () => {
    if (!inputText.trim() || isProcessed) return;
    
    if (isListening && mediaRecorder) {
      mediaRecorder.stop();
      setIsListening(false);
    }

    const userMessage = inputText;
    setMessages(prev => [...prev, { id: Date.now().toString(), role: "user", text: userMessage }]);
    setInputText("");
    setIsProcessingAI(true);
    
    try {
      // Append this turn, then re-parse everything said so far.
      const combined = [conversationTextRef.current, userMessage]
        .filter(Boolean)
        .join('. ')
        .trim();

      const res = await fetch("/api/items/voice-parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regionalTranscript: combined, language })
      });
      const result = await res.json();

      if (res.ok && result.data) {
        conversationTextRef.current = combined;
        applyParse(result.data);
      } else {
        setNotice({ tone: "error", title: t('ai_parsing_failed') });
        setMessages(prev => [...prev, { id: Date.now().toString(), role: "assistant", text: t('ai_parsing_failed') }]);
      }
    } catch (e) {
      console.error(e);
      setNotice({ tone: "error", title: t('ai_parsing_network_error') });
      setMessages(prev => [...prev, { id: Date.now().toString(), role: "assistant", text: t('ai_parsing_network_error') }]);
    } finally {
      setIsProcessingAI(false);
    }
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setIsCameraActive(true);
      }
    } catch (err) {
      console.error("Error accessing camera:", err);
      setNotice({ tone: "warning", title: t('camera_blocked'), body: t('camera_blocked_body') });
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
      setIsCameraActive(false);
    }
  };

  useEffect(() => {
    if (!isOpen || step !== 2) {
      stopCamera();
    }
  }, [isOpen, step]);

  // A live recogniser left running after the modal closes keeps the mic hot.
  useEffect(() => {
    if (isOpen) return;
    try {
      recognitionRef.current?.stop();
    } catch {
      // Already stopped.
    }
    recognitionRef.current = null;
  }, [isOpen]);

  if (!isOpen) return null;

  const captureFrame = async () => {
    if (videoRef.current && canvasRef.current) {
      const context = canvasRef.current.getContext("2d");
      if (context) {
        context.drawImage(videoRef.current, 0, 0, canvasRef.current.width, canvasRef.current.height);
        if (images.length >= 4) {
          setNotice({ tone: "warning", title: t('max_images') });
          return;
        }
        // Compressed before it ever reaches state: a full-resolution PNG here
        // was megabytes of base64 that then travelled with the row forever.
        const dataUrl = await downscaleImage(canvasRef.current.toDataURL("image/png"));
        setImages((prev) => [...prev, dataUrl]);
      }
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = async (event) => {
        if (!event.target?.result) return;
        if (images.length >= 4) {
          setNotice({ tone: "warning", title: t('max_images') });
          return;
        }
        // A phone photo is 3-8 MB; store a capped JPEG instead.
        const dataUrl = await downscaleImage(event.target.result as string);
        setImages((prev) => [...prev, dataUrl]);
      };
      reader.readAsDataURL(file);
    }
  };

  const removeImage = (index: number) => {
    setImages(images.filter((_, i) => i !== index));
    setIsVisionVerified(false);
    // Clearing the rejection re-arms the verification effect for the next photo.
    setVisionRejected(false);
    setRejectionReason("");
  };

  /** "Try another photo" on the rejection banner. */
  const discardRejectedImages = () => {
    setImages([]);
    setIsVisionVerified(false);
    setVisionRejected(false);
    setRejectionReason("");
    setBackgroundRemoved(false);
  };


  const handleNext = () => {
    if (step < 3) {
      setStep(step + 1);
    }
  };

  const resetAndClose = () => {
    onClose();
    setTimeout(() => {
      setStep(1);
      setIsProcessed(false);
      setImages([]);
      setLaborDays(0);
      setRawMaterialCost(0);
      setIsVisionVerified(false);
      setIsVerifyingVision(false);
      setVisionRejected(false);
      setRejectionReason("");
      setNotice(null);
      setEcommerceDescEnglish("");
      setEcommerceDescLocal("");
      setCreatedItemId(null);
      setOriginalTranscript("");
      setEnglishDescription("");
      setSourceLanguage("");
      setAskingPrice("");
      setPriceTouched(false);
      setInputText("");
      setMessages([]);
      // Step 1 starts from nothing again: a stale running transcript would let
      // the next capture inherit the previous item's facts.
      conversationTextRef.current = "";
      setFacts({ product: false, time: false, materials: false });
      setHasParsed(false);
      setTechnique(null);
      if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
      }
    }, 500);
  };
  
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-3xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl animate-fade-in-up">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
          <div>
            <h2 className="font-serif font-bold text-xl text-primary">{t('new_craft_capture')}</h2>
            {step <= 3 && <p className="text-xs text-gray-500">Step {step} of 3</p>}
          </div>
          <button onClick={resetAndClose} className="p-2 hover:bg-gray-200 rounded-full transition-colors text-gray-500">
            <X size={20} />
          </button>
        </div>

        {/* In-app notice — replaces the browser alerts this modal used to fire */}
        {notice && (
          <div
            role="alert"
            className={cn(
              "mx-6 mt-4 px-4 py-3 rounded-xl border flex items-start gap-3 text-sm animate-fade-in-up",
              notice.tone === "error"
                ? "bg-red-50 border-red-200 text-red-800"
                : "bg-yellow-50 border-yellow-200 text-yellow-800"
            )}
          >
            <AlertTriangle size={18} className="shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="font-bold">{notice.title}</p>
              {notice.body && <p className="mt-1 text-xs leading-relaxed opacity-90">{notice.body}</p>}
            </div>
            <button
              onClick={() => setNotice(null)}
              className="shrink-0 p-1 rounded-full hover:bg-black/5 transition-colors"
              aria-label={t('close_btn')}
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Content */}
        <div className="p-8 flex-grow overflow-y-auto">
          {/* Step 1: ChatGPT-style AI Input */}
          {step === 1 && (
            <div className="flex flex-col h-[500px] animate-fade-in-up bg-gray-50/50 rounded-2xl border border-gray-100 p-2 overflow-hidden">
              <div className="flex-1 overflow-y-auto p-4 space-y-6">
                
                {messages.map((msg) => (
                  <div key={msg.id} className={cn("flex gap-4 max-w-[90%] animate-fade-in-up", msg.role === 'user' ? 'ml-auto flex-row-reverse' : '')}>
                    <div className={cn("w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-1", msg.role === 'assistant' ? 'bg-primary' : 'bg-gray-200 overflow-hidden border border-gray-200')}>
                      {msg.role === 'assistant' ? <Sparkles size={16} className="text-white" /> : <Image src="/female_artisan.jpg" alt="User" width={32} height={32} className="object-cover" />}
                    </div>
                    <div className={cn("p-4 rounded-2xl shadow-sm break-words", msg.role === 'assistant' ? 'bg-white rounded-tl-none border border-gray-100 text-gray-800 font-medium' : 'bg-primary rounded-tr-none text-white leading-relaxed whitespace-pre-wrap')}>
                      {msg.text}
                    </div>
                  </div>
                ))}

                {inputText && (
                  <div className="flex gap-4 max-w-[90%] ml-auto flex-row-reverse animate-fade-in-up">
                    <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center shrink-0 overflow-hidden mt-1 border border-gray-200">
                      <Image src="/female_artisan.jpg" alt="User" width={32} height={32} className="object-cover" />
                    </div>
                    <div className="bg-primary p-4 rounded-2xl rounded-tr-none text-white shadow-sm break-words opacity-80">
                      <p className="leading-relaxed whitespace-pre-wrap">{inputText}</p>
                      {isListening && <span className="inline-block w-2 h-4 bg-white/70 animate-pulse ml-1 align-middle"></span>}
                    </div>
                  </div>
                )}

                {/* Processing Bubble */}
                {isProcessingAI && (
                  <div className="flex gap-4 max-w-[90%] animate-fade-in-up">
                    <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center shrink-0 mt-1">
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    </div>
                    <div className="bg-white p-4 rounded-2xl rounded-tl-none border border-gray-100 shadow-sm flex items-center gap-3">
                      <div className="flex gap-1">
                        <span className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0ms' }}></span>
                        <span className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '150ms' }}></span>
                        <span className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '300ms' }}></span>
                      </div>
                      <span className="text-gray-500 text-sm font-medium">Voice-Scribe Agent is parsing your craft...</span>
                    </div>
                  </div>
                )}

                {/* Final Result Bubble */}
                {isProcessed && (
                  <div className="flex gap-4 max-w-[90%] animate-fade-in-up">
                    <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center shrink-0 mt-1 shadow-sm shadow-green-500/20">
                      <CheckCircle2 size={16} className="text-white" />
                    </div>
                    <div className="bg-white p-4 rounded-2xl rounded-tl-none border border-green-200 shadow-sm space-y-3 w-full">
                      <div className="flex items-center justify-between pb-2 border-b border-gray-100">
                        <span className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                          <Sparkles size={12}/> Voice-Scribe Output
                        </span>
                        {sourceLanguage && <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-md text-[10px] font-bold border border-gray-200">{sourceLanguage} Detected</span>}
                      </div>
                      {/* Editable: the artisan owns this text, not the model. */}
                      <label className="block">
                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1 mb-1">
                          <Pencil size={10} /> {t('english_description_editable')}
                        </span>
                        <textarea
                          value={englishDescription}
                          onChange={(e) => setEnglishDescription(e.target.value)}
                          rows={3}
                          className="w-full text-md text-gray-800 font-medium leading-relaxed bg-gray-50 border border-gray-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all resize-y"
                        />
                      </label>

                      <div className="flex flex-wrap gap-2 pt-2">
                        <span className="px-3 py-1.5 bg-green-50 text-green-700 text-xs font-bold rounded-lg flex items-center gap-1.5 border border-green-100">
                          <Sparkles size={12} className="text-green-500" /> {laborDays} Days Labor
                        </span>
                        <span className="px-3 py-1.5 bg-green-50 text-green-700 text-xs font-bold rounded-lg flex items-center gap-1.5 border border-green-100">
                          <Sparkles size={12} className="text-green-500" /> ₹{rawMaterialCost} Materials
                        </span>
                      </div>
                      
                      <p className="text-xs text-gray-400 mt-2 font-medium bg-gray-50 p-2 rounded-lg text-center border border-gray-100">
                        Looks good! Click Continue to take photos.
                      </p>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input Area */}
              {!isProcessed && (
                <div className="p-3 bg-white border-t border-gray-100 rounded-xl relative shadow-[0_-10px_20px_-10px_rgba(0,0,0,0.05)]">
                  {/* What is still needed before Step 2 opens. Shown only once
                      something has been parsed, so the artisan is not greeted
                      by three empty circles. */}
                  {hasParsed && (
                    <div className="mb-2 flex flex-wrap items-center gap-1.5">
                      {([
                        ['product', t('checklist_product')],
                        ['time', t('checklist_time')],
                        ['materials', t('checklist_materials')],
                      ] as const).map(([key, label]) => {
                        const done = facts[key];
                        return (
                          <span
                            key={key}
                            className={cn(
                              "inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full border",
                              done
                                ? "bg-[var(--color-mint)] text-primary border-[var(--color-sage)]"
                                : "bg-gray-50 text-gray-400 border-gray-200"
                            )}
                          >
                            {done ? "✓" : "○"} {label}
                          </span>
                        );
                      })}
                    </div>
                  )}

                  {/* Live caption while the mic is open, so the artisan can see
                      they are being heard before the recording is uploaded. */}
                  {isListening && (
                    <div className="mb-2 flex items-start gap-2 rounded-xl bg-[var(--color-mint)]/60 border border-[var(--color-sage)]/50 px-3 py-2">
                      <span className="mt-1 w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0" />
                      <p className="text-xs text-primary leading-relaxed">
                        {liveTranscript || t('listening')}
                      </p>
                    </div>
                  )}

                  <div className="flex items-end gap-2 bg-gray-50 border border-gray-200 rounded-2xl p-2 focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary transition-all">
                    <textarea
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      placeholder={t('chat_placeholder')}
                      className="flex-1 bg-transparent border-none resize-none max-h-32 min-h-[44px] py-2.5 px-3 focus:ring-0 text-sm text-gray-800 font-medium"
                      rows={1}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          processWithAI();
                        }
                      }}
                    />
                    <div className="flex gap-2 pb-1 pr-1 shrink-0">
                      <button
                        onClick={toggleListening}
                        className={cn(
                          "w-10 h-10 rounded-full flex items-center justify-center transition-all", 
                          isListening 
                            ? "bg-red-50 text-red-500 border border-red-200 animate-pulse shadow-inner" 
                            : "bg-primary text-white hover:bg-primary-dark shadow-md animate-bounce"
                        )}
                        title={t('start_listening')}
                      >
                        <Mic size={18} className={isListening ? "animate-pulse" : ""} />
                      </button>
                      <button
                        onClick={() => processWithAI()}
                        disabled={!inputText.trim() || isProcessingAI}
                        className="w-10 h-10 rounded-full bg-primary text-white flex items-center justify-center hover:bg-primary-dark disabled:bg-gray-200 disabled:text-gray-400 transition-all shadow-md disabled:shadow-none"
                        title={t('process_ai')}
                      >
                        <ArrowRight size={18} />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 2: Dual Camera & Upload */}
          {step === 2 && (
            <div className="animate-fade-in-up flex flex-col h-full">
              <h3 className="text-2xl font-bold mb-2">{t('craft_photos')}</h3>
              <p className="text-gray-500 mb-6">Capture the craft using your live camera or upload existing photos.</p>
              
              {isEnhancingImage ? (
                <div className="bg-purple-50 border border-purple-200 text-purple-800 px-4 py-3 rounded-xl mb-6 text-sm flex gap-3 items-center shadow-sm animate-pulse">
                  <Sparkles size={20} className="text-purple-600" />
                  <p className="font-bold">{t('enhancing_image')}</p>
                </div>
              ) : isVerifyingVision && (
                <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded-xl mb-6 text-sm flex gap-3 items-center shadow-sm">
                  <div className="w-5 h-5 border-2 border-yellow-400 border-t-yellow-800 rounded-full animate-spin"></div>
                  <p className="font-bold">Vision-Sentinel Agent is verifying authenticity...</p>
                </div>
              )}

              {/* Rejection is an in-app banner, mirroring the green one below —
                  the photos stay on screen so the artisan can see what failed. */}
              {visionRejected && (
                <div
                  role="alert"
                  className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-xl mb-6 text-sm flex gap-3 items-start shadow-sm animate-fade-in-up"
                >
                  <AlertTriangle size={20} className="text-red-600 shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="font-bold">{t('vision_rejected_title')}</p>
                    <p className="mt-1 text-xs leading-relaxed text-red-700">{rejectionReason}</p>
                    <button
                      onClick={discardRejectedImages}
                      className="mt-3 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition-colors"
                    >
                      {t('try_another_photo')}
                    </button>
                  </div>
                </div>
              )}

              {isVisionVerified && images.length > 0 && (
                <div className="mb-6 space-y-4">
                  <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-xl text-sm flex gap-3 items-center shadow-sm animate-fade-in-up">
                    <ShieldCheck size={20} className="text-green-600 shrink-0" />
                    <p>
                      <strong>{t('ai_verified_enhanced')}</strong>{' '}
                      {/* Says which of the two actually happened, rather than
                          claiming a cutout that may have timed out. */}
                      {backgroundRemoved ? t('bg_removed_note') : t('bg_kept_note')}
                    </p>
                  </div>

                  {/* Both listings are editable before save. The English one is
                      the text that goes out as the ONDC listing. */}
                  <div className="bg-white border border-gray-200 p-4 rounded-xl shadow-sm animate-fade-in-up">
                    <div className="flex items-center gap-2 mb-1">
                      <Globe size={16} className="text-blue-500"/>
                      <h4 className="font-bold text-sm text-gray-800">{t('listing_english_title')}</h4>
                      <span className="ml-auto text-[10px] font-bold uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-100 px-2 py-0.5 rounded-full">
                        {t('ondc_listing_tag')}
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-500 mb-2">{t('listing_english_help')}</p>
                    <textarea
                      value={ecommerceDescEnglish}
                      onChange={(e) => setEcommerceDescEnglish(e.target.value)}
                      rows={5}
                      placeholder={t('listing_english_placeholder')}
                      className="w-full text-xs text-gray-700 leading-relaxed bg-gray-50 border border-gray-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all resize-y"
                    />
                  </div>

                  <div className="bg-white border border-gray-200 p-4 rounded-xl shadow-sm animate-fade-in-up">
                    <div className="flex items-center gap-2 mb-1">
                      <Globe size={16} className="text-green-600"/>
                      <h4 className="font-bold text-sm text-gray-800">
                        {t('listing_local_title')} ({language.toUpperCase()})
                      </h4>
                    </div>
                    <p className="text-[11px] text-gray-500 mb-2">{t('listing_local_help')}</p>
                    <textarea
                      value={ecommerceDescLocal}
                      onChange={(e) => setEcommerceDescLocal(e.target.value)}
                      rows={5}
                      placeholder={originalTranscript || t('listing_local_placeholder')}
                      className="w-full text-xs text-gray-700 leading-relaxed bg-gray-50 border border-gray-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all resize-y"
                    />
                    {originalTranscript && ecommerceDescLocal.trim() !== originalTranscript.trim() && (
                      <button
                        onClick={() => setEcommerceDescLocal(originalTranscript)}
                        className="mt-2 text-[11px] font-bold text-primary hover:underline"
                      >
                        {t('use_my_own_words')}
                      </button>
                    )}
                  </div>
                </div>
              )}
              
              <div className="grid grid-cols-2 gap-4 mb-6">
                <button 
                  onClick={startCamera}
                  className={cn("py-3 rounded-xl font-bold flex items-center justify-center gap-2 border-2 transition-all", isCameraActive ? "bg-primary text-white border-primary" : "bg-white text-gray-700 border-gray-200 hover:border-primary")}
                >
                  <Camera size={18} /> {t('capture_camera')}
                </button>
                <label className="py-3 rounded-xl font-bold flex items-center justify-center gap-2 border-2 bg-white text-gray-700 border-gray-200 hover:border-primary cursor-pointer transition-all">
                  <UploadCloud size={18} /> {t('upload_device')}
                  <input type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
                </label>
              </div>

              {/* Camera Viewfinder */}
              {isCameraActive && (
                <div className="relative bg-black rounded-2xl overflow-hidden aspect-video mb-6 flex flex-col items-center justify-end shadow-inner">
                  <video ref={videoRef} autoPlay playsInline className="absolute inset-0 w-full h-full object-cover" />
                  <canvas ref={canvasRef} width="640" height="480" className="hidden" />
                  <button 
                    onClick={captureFrame}
                    className="relative z-10 mb-4 w-14 h-14 bg-white/30 backdrop-blur-md border-4 border-white rounded-full flex items-center justify-center hover:bg-white/50 transition-all active:scale-95 shadow-lg"
                  >
                    <div className="w-10 h-10 bg-white rounded-full"></div>
                  </button>
                  <button onClick={stopCamera} className="absolute top-2 right-2 bg-black/50 text-white p-2 rounded-full hover:bg-black/70 z-10">
                    <X size={16} />
                  </button>
                </div>
              )}

              {/* Image Grid */}
              {images.length > 0 && (
                <div>
                  <h4 className="font-bold text-sm text-gray-500 mb-3 uppercase tracking-wider">Captured Images ({images.length})</h4>
                  <div className="grid grid-cols-3 gap-3">
                    {images.map((img, idx) => (
                      <div key={idx} className="relative aspect-square rounded-xl overflow-hidden border border-gray-200 group">
                        <Image src={img} alt={`Capture ${idx}`} fill className={cn("object-cover transition-all duration-1000", isVisionVerified ? "brightness-110 contrast-105 saturate-110" : "")} />
                        <button 
                          onClick={() => removeImage(idx)}
                          className="absolute top-1 right-1 bg-red-500 text-white p-1.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {images.length === 0 && !isCameraActive && (
                <div className="flex-grow flex flex-col items-center justify-center border-2 border-dashed border-gray-200 rounded-2xl bg-gray-50 text-gray-400 py-12">
                  <Camera size={40} className="mb-2 opacity-50" />
                  <p>No photos captured yet.</p>
                </div>
              )}
            </div>
          )}

          {/* Step 3: Set your price, then raw material proof */}
          {step === 3 && (
            <div className="animate-fade-in-up">
              <h3 className="text-2xl font-bold mb-2">{t('set_your_price')}</h3>

              {/* AI guidance first, so the artisan is never guessing blind. */}
              <div className="bg-[#DCEBE0] border border-primary/15 rounded-2xl px-4 py-3 mb-4 flex gap-3 items-start">
                <Sparkles className="shrink-0 mt-0.5 text-primary" size={16} />
                <div className="text-sm text-primary leading-relaxed">
                  <p className="font-bold">
                    {t('price_ai_suggests').replace(
                      '{band}',
                      `${formatRupees(valuation.marketPriceMin)} – ${formatRupees(valuation.marketPriceMax)}`
                    )}
                  </p>
                  <p className="opacity-80">
                    {t('price_fair_floor_note').replace('{amount}', formatRupees(valuation.fairWageFloor))}
                  </p>
                  {!hasValuationInput && (
                    <p className="opacity-80 mt-1">{t('price_needs_labour_first')}</p>
                  )}
                </div>
              </div>

              <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">
                {t('asking_price_label')}
              </label>
              <div className="relative mb-2">
                <IndianRupee
                  size={18}
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
                />
                <input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={askingPrice}
                  onChange={(e) => {
                    setPriceTouched(true);
                    setAskingPrice(e.target.value);
                  }}
                  className={cn(
                    "w-full pl-11 pr-4 py-4 rounded-2xl border-2 bg-white text-lg font-bold text-gray-900 focus:outline-none transition-colors",
                    isBelowFairFloor
                      ? "border-amber-300 focus:border-amber-400"
                      : "border-gray-200 focus:border-primary"
                  )}
                />
              </div>
              <p className="text-xs text-gray-400 mb-4">{t('asking_price_hint')}</p>

              {/* ---- Dynamic Pricing Assistant --------------------------------
                  Estimated comparable bands per platform, then one recommended
                  price the artisan can apply in a tap. Explicitly labelled as
                  estimates: these are not live scraped listings. */}
              <div className="border border-[var(--color-sage)]/60 bg-[var(--color-mint)]/25 rounded-2xl p-4 mb-6">
                <div className="flex items-start justify-between gap-3 mb-1">
                  <h4 className="text-sm font-bold text-primary flex items-center gap-2">
                    <TrendingUp size={16} /> {t('pricing_assistant')}
                  </h4>
                  {priceResearch && (
                    <button
                      type="button"
                      onClick={runPriceResearch}
                      disabled={priceResearchLoading}
                      aria-label={t('retry')}
                      className="p-1.5 text-primary/70 hover:text-primary transition-colors disabled:opacity-50"
                    >
                      <RefreshCw size={14} />
                    </button>
                  )}
                </div>
                <p className="text-xs text-gray-600 leading-relaxed mb-3">
                  {t('pricing_assistant_subtitle')}
                </p>

                {!priceResearch && !priceResearchLoading && (
                  <button
                    type="button"
                    onClick={runPriceResearch}
                    className="w-full bg-primary hover:bg-primary-dark text-white py-2.5 rounded-xl font-bold text-sm transition-colors"
                  >
                    {t('find_similar_prices')}
                  </button>
                )}

                {priceResearchLoading && (
                  <div className="flex items-center justify-center gap-2 py-6 text-primary">
                    <Loader2 size={18} className="animate-spin" />
                    <span className="text-sm font-bold">{t('pricing_searching')}</span>
                  </div>
                )}

                {priceResearchError && !priceResearchLoading && (
                  <div className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                    {priceResearchError}
                  </div>
                )}

                {priceResearch && !priceResearchLoading && (
                  <div className="space-y-3">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500">
                      {t('similar_items_found')}
                    </p>

                    <div className="space-y-2">
                      {priceResearch.comparables.map((row, i) => (
                        <div
                          key={`${row.platform}-${i}`}
                          className="bg-white border border-gray-100 rounded-xl px-3 py-2.5"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-primary">{row.platform}</p>
                              <p className="text-[11px] text-gray-500 truncate">{row.title}</p>
                            </div>
                            <p className="text-xs font-bold text-gray-900 whitespace-nowrap">
                              {formatRupees(row.priceMin)} – {formatRupees(row.priceMax)}
                            </p>
                          </div>
                          {row.note && (
                            <p className="text-[11px] text-gray-400 mt-1 leading-snug">{row.note}</p>
                          )}
                        </div>
                      ))}
                    </div>

                    <div className="bg-primary text-white rounded-xl px-4 py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-white/60">
                          {t('recommended_price')}
                        </p>
                        <p className="text-xl font-serif font-bold">
                          {formatRupees(priceResearch.recommendedPrice)}
                        </p>
                        {priceResearch.clampedToFloor && (
                          <p className="text-[10px] text-white/70 mt-0.5">{t('price_raised_to_floor')}</p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setPriceTouched(true);
                          setAskingPrice(String(priceResearch.recommendedPrice));
                        }}
                        className="bg-white text-primary px-4 py-2 rounded-lg font-bold text-xs hover:bg-gray-100 transition-colors shrink-0"
                      >
                        {t('use_this_price')}
                      </button>
                    </div>

                    {priceResearch.rationale && (
                      <p className="text-[11px] text-gray-600 leading-relaxed">{priceResearch.rationale}</p>
                    )}

                    <p className="text-[10px] text-gray-400 italic leading-relaxed">
                      {t('pricing_estimates_note')}
                    </p>
                  </div>
                )}
              </div>

              {/* Warns, never blocks: the artisan's price is still their choice. */}
              {isBelowFairFloor && (
                <div className="bg-amber-50 border border-amber-200 text-amber-900 px-4 py-3 rounded-xl mb-6 text-sm flex gap-2 items-start">
                  <AlertTriangle className="shrink-0 mt-0.5" size={16} />
                  <p>{t('price_below_floor_warning')}</p>
                </div>
              )}

              <div className="border-t border-gray-100 pt-6" />

              <h3 className="text-2xl font-bold mb-2">{t('raw_material_proof')}</h3>
              <div className="bg-blue-50 border border-blue-100 text-blue-800 px-4 py-3 rounded-xl mb-6 text-sm flex gap-2 items-start">
                <Sparkles className="shrink-0 mt-0.5" size={16} />
                <p><strong>Optional:</strong> Upload your raw material bills or receipts. This increases your <strong>Fairness Score</strong> and helps you get a better valuation.</p>
              </div>
              
              <div className="w-full h-48 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-300 flex flex-col items-center justify-center text-gray-500 cursor-pointer hover:bg-gray-100 transition-colors mb-6">
                <FileText size={40} className="mb-3 text-gray-400" />
                <span className="font-medium text-gray-700">{t('upload_bill')}</span>
                <span className="text-xs text-gray-400 mt-1">JPEG, PNG, or PDF</span>
              </div>
            </div>
          )}

          {/* Success Step */}
          {step === 4 && (
            <div className="flex flex-col items-center justify-center py-12 text-center animate-fade-in-up">
              <div className="w-24 h-24 bg-green-50 rounded-full flex items-center justify-center mb-6">
                <CheckCircle2 size={48} className="text-green-500" />
              </div>
              <h3 className="text-3xl font-bold mb-3">Upload Successful!</h3>
              <p className="text-gray-500 mb-8 max-w-sm">Your craft has been saved to your digital portfolio.</p>
              
              <button
                onClick={resetAndClose}
                className="w-full max-w-sm bg-primary text-white py-4 rounded-2xl font-bold hover:bg-primary-dark transition-all text-lg shadow-xl shadow-primary/20"
              >
                Back to Dashboard
              </button>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        {step < 4 && (
          <div className="p-6 border-t border-gray-100 bg-gray-50/50 flex justify-between items-center shrink-0">
            {step > 1 ? (
              <button 
                onClick={() => setStep(step - 1)}
                className="px-6 py-3 rounded-xl font-bold text-gray-500 hover:bg-gray-200 transition-colors"
              >
                Back
              </button>
            ) : <div></div>}
            
            {step === 3 ? (
              <button 
                onClick={handleSaveUpload}
                disabled={isCreatingDraft}
                className="px-8 py-3 rounded-xl font-bold bg-primary text-white hover:bg-primary-dark transition-all flex items-center gap-2 shadow-lg shadow-primary/20 disabled:bg-gray-400"
              >
                {isCreatingDraft ? "Saving..." : "Save Upload"} <CheckCircle2 size={18} />
              </button>
            ) : (
              <button 
                onClick={handleNext}
                disabled={(step === 1 && !isProcessed) || (step === 2 && (!isVisionVerified || images.length === 0))}
                className="px-8 py-3 rounded-xl font-bold bg-primary text-white hover:bg-primary-dark transition-all flex items-center gap-2 shadow-lg shadow-primary/20 disabled:bg-gray-200 disabled:text-gray-400 disabled:shadow-none"
              >
                {step === 1 ? (
                  <>Next & Capture <Camera size={18} /></>
                ) : (
                  <>Next <ArrowRight size={18} /></>
                )}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
