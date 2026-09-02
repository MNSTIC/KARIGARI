"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, ExternalLink, Loader2, Mic, MicOff, Send } from "lucide-react";
import { useLanguage } from "@/lib/translations";
import { cn } from "@/lib/utils";

/**
 * The AI Craft Assistant conversation.
 *
 * One implementation, two frames: the Learn page docks it in a column, and
 * `LearningAssistantModal` wraps the same component in a sheet. Both talk to
 * the real `POST /api/artisan/chat`, which answers in the artisan's language
 * and finds one genuinely relevant, embeddable tutorial.
 *
 * There is no attachment control. The chat route takes a question, a craft and
 * a language — it has no vision path — so a paperclip here would be a button
 * that cannot do anything.
 */

export type ChatMessage = {
  role: "user" | "assistant";
  text: string;
  videoId?: string | null;
  /** Offered instead of an embed when nothing relevant was embeddable. */
  searchUrl?: string | null;
};

export function AssistantChat({
  craftType,
  seedQuestion,
  onClose,
  className,
  headerAction,
}: {
  craftType?: string | null;
  /**
   * A question to put in the box when the assistant opens, so a technique card
   * lands the artisan on a real answer instead of an empty chat. Prefilled, not
   * auto-sent: a question the artisan did not ask should not burn an AI call or
   * put words in their mouth.
   */
  seedQuestion?: string | null;
  onClose?: () => void;
  className?: string;
  headerAction?: React.ReactNode;
}) {
  const { t, language } = useLanguage();
  const craft = (craftType || "").trim() || t("your_craft");

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isListening, setIsListening] = useState(false);
  /* Held in state, not read off the ref: a ref assignment does not re-render,
     so the dictation button would never appear on the first paint. */
  const [speechSupported, setSpeechSupported] = useState(false);
  const recognitionRef = useRef<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Seeded here rather than in useState so the greeting names the artisan's
  // real craft once the profile has been handed down.
  useEffect(() => {
    const kickoff = setTimeout(() => {
      setMessages((prev) =>
        prev.length > 0 ? prev : [{ role: "assistant", text: `${t("learn_greeting")} ${craft}?` }]
      );
    }, 0);
    return () => clearTimeout(kickoff);
  }, [craft, t]);

  useEffect(() => {
    if (!seedQuestion) return;
    const kickoff = setTimeout(() => setInput(seedQuestion), 0);
    return () => clearTimeout(kickoff);
  }, [seedQuestion]);

  // Keep the newest turn in view without yanking the whole page.
  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, isTyping]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onresult = (event: any) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        transcript += event.results[i][0].transcript;
      }
      setInput(transcript);
    };
    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);
    recognitionRef.current = recognition;
    setSpeechSupported(true);

    return () => {
      recognition.stop();
    };
  }, []);

  const toggleListening = () => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    if (isListening) {
      recognition.stop();
      setIsListening(false);
      return;
    }
    setInput("");
    try {
      recognition.start();
      setIsListening(true);
    } catch (e) {
      console.error(e);
      setIsListening(false);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isTyping) return;

    const userMsg = input.trim();
    setMessages((prev) => [...prev, { role: "user", text: userMsg }]);
    setInput("");
    setIsTyping(true);

    try {
      const res = await fetch("/api/artisan/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMsg, craftType: craft, language }),
      });
      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: data.reply || t("chat_no_answer"),
          videoId: data.videoId ?? null,
          searchUrl: data.searchUrl ?? null,
        },
      ]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", text: t("chat_network_error") }]);
    }

    setIsTyping(false);
  };

  return (
    <div className={cn("flex min-h-0 flex-col overflow-hidden bg-card", className)}>
      {/* ------------------------------------------------------- Header */}
      <div className="flex shrink-0 items-center gap-3 bg-primary px-5 py-4 text-white">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10">
          <Bot size={19} />
        </span>
        <div className="min-w-0">
          <h2 className="kg-display text-[17px] leading-tight">AI Craft Assistant</h2>
          <p className="kg-label mt-1 flex items-center gap-1.5 text-white/55">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--color-rust)]" />
            Online
          </p>
        </div>
        {headerAction && <div className="ml-auto shrink-0">{headerAction}</div>}
        {onClose && !headerAction && (
          <button
            onClick={onClose}
            aria-label={t("close_btn")}
            className="kg-press ml-auto rounded-full bg-white/10 p-2 hover:bg-white/20"
          >
            <span aria-hidden>✕</span>
          </button>
        )}
      </div>

      {/* -------------------------------------------------------- Thread */}
      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto bg-[var(--color-background)] p-4"
      >
        {messages.map((msg, i) => (
          <div
            key={i}
            className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}
          >
            <div
              className={cn(
                "max-w-[88%] rounded-2xl p-4 text-[14px] leading-relaxed",
                msg.role === "user"
                  ? "rounded-tr-md bg-primary text-white"
                  : "rounded-tl-md bg-[var(--color-gray-100)] text-gray-800"
              )}
            >
              <p className="whitespace-pre-line">{msg.text}</p>

              {/* A relevant embeddable tutorial, or a search link when there
                  was none — never a random unrelated embed. */}
              {!msg.videoId && msg.searchUrl && msg.role === "assistant" && (
                <a
                  href={msg.searchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-gray-900 hover:underline"
                >
                  {t("search_on_youtube")} <ExternalLink size={12} />
                </a>
              )}

              {msg.videoId && (
                <div className="relative mt-4 aspect-video overflow-hidden rounded-xl bg-black">
                  <iframe
                    width="100%"
                    height="100%"
                    src={`https://www.youtube.com/embed/${msg.videoId}?controls=1`}
                    title="Tutorial video"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    className="absolute inset-0 border-0"
                  />
                </div>
              )}
            </div>
          </div>
        ))}

        {isTyping && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-2xl rounded-tl-md bg-[var(--color-gray-100)] p-4">
              <Loader2 size={15} className="animate-spin text-gray-500" />
              <span className="text-sm font-medium text-gray-500">{t("typing")}</span>
            </div>
          </div>
        )}
      </div>

      {/* --------------------------------------------------------- Input */}
      <div className="flex shrink-0 items-center gap-2 border-t border-gray-200/70 bg-card p-3">
        {speechSupported && (
          <button
            onClick={toggleListening}
            aria-label={isListening ? "Stop dictation" : "Dictate"}
            className={cn(
              "kg-press flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors",
              isListening
                ? "animate-pulse bg-red-50 text-red-600"
                : "bg-[var(--color-pill)] text-gray-600 hover:bg-gray-200"
            )}
          >
            {isListening ? <MicOff size={18} /> : <Mic size={18} />}
          </button>
        )}
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder={t("assistant_placeholder")}
          className="h-11 min-w-0 flex-1 rounded-full border border-gray-200 bg-[var(--color-background)] px-5 text-[14px] focus:border-gray-900 focus:outline-none"
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || isTyping}
          aria-label="Send"
          className="kg-press flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-white hover:bg-primary-dark disabled:opacity-40"
        >
          <Send size={17} />
        </button>
      </div>
    </div>
  );
}
