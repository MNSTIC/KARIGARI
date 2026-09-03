"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, CheckCircle2, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { useLanguage } from "@/lib/translations";
import { cn } from "@/lib/utils";

/**
 * F6 — Step 1's follow-up assistant.
 *
 * Runs alongside the existing voice-parse chat (which understands what was
 * said); this component fills in what was left OUT. Once the artisan has a
 * craft type and a description in play, it asks Gemini for the single most
 * useful missing detail, at most three times. On complete it fires
 * `onExtracted` so the parent can adopt any technique/material Gemini pinned
 * down that the voice-parse pipeline missed.
 *
 * Never blocks Step 1. The "Skip" button ends the loop and hands control back
 * to the artisan; a server that says "complete" or fails does the same
 * silently.
 */

export interface SmartDraftExtracted {
  craftType?: string | null;
  material?: string | null;
  technique?: string | null;
  estimatedLaborDays?: number | null;
  specialNotes?: string | null;
}

interface Props {
  craftType: string;
  description: string;
  onExtracted?: (data: SmartDraftExtracted) => void;
}

type Turn = { role: "assistant" | "user"; text: string };

interface DraftResponse {
  success: true;
  status: "need_more_info" | "complete" | "verification_needed";
  question?: string;
  extractedData: SmartDraftExtracted;
  verificationNote?: string;
  readyToProceed: boolean;
}

const MAX_ROUNDS = 3;

export function SmartDraftAssistant({ craftType, description, onExtracted }: Props) {
  const { t } = useLanguage();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [verificationNote, setVerificationNote] = useState<string | null>(null);
  // Once we have started a conversation for a particular (craftType,description)
  // pair we do not restart it — otherwise every keystroke in the outer chat
  // would fire a new round.
  const startedRef = useRef(false);

  const ready = craftType.trim().length >= 3 && description.trim().length >= 20;

  // Declared before the effect that calls it — hoisting is required by the
  // "no use before declaration" hook lint, and it lets both branches share
  // exactly one response translator.
  const applyResponse = useCallback(
    (data: DraftResponse, priorTurns: Turn[]) => {
      if (data.verificationNote) setVerificationNote(data.verificationNote);
      if (
        data.status === "need_more_info" &&
        data.question &&
        priorTurns.length < MAX_ROUNDS * 2
      ) {
        setTurns([...priorTurns, { role: "assistant", text: data.question }]);
      } else {
        setDone(true);
        onExtracted?.(data.extractedData);
      }
    },
    [onExtracted]
  );

  useEffect(() => {
    if (!ready || done || skipped || startedRef.current) return;
    startedRef.current = true;

    (async () => {
      setBusy(true);
      try {
        const res = await fetch("/api/items/smart-draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            craftType,
            description,
            previousQuestions: [],
            previousAnswers: [],
          }),
        });
        const data = (await res.json()) as DraftResponse;
        applyResponse(data, []);
      } catch (error) {
        console.warn("Smart draft init failed:", error);
        setDone(true);
      } finally {
        setBusy(false);
      }
    })();
    // The pair (craftType,description) is a single conversation, so we do not
    // want later keystrokes to re-run this. `applyResponse`/`done`/`skipped`
    // are covered by `startedRef` and internal state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const send = async () => {
    if (!answer.trim() || busy) return;
    setBusy(true);
    const nextTurns: Turn[] = [...turns, { role: "user", text: answer.trim() }];
    setTurns(nextTurns);
    const previousQuestions = nextTurns
      .filter((turn) => turn.role === "assistant")
      .map((turn) => turn.text);
    const previousAnswers = nextTurns
      .filter((turn) => turn.role === "user")
      .map((turn) => turn.text);
    setAnswer("");

    try {
      const res = await fetch("/api/items/smart-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          craftType,
          description,
          previousQuestions,
          previousAnswers,
        }),
      });
      const data = (await res.json()) as DraftResponse;
      applyResponse(data, nextTurns);
    } catch (error) {
      console.warn("Smart draft turn failed:", error);
      setDone(true);
    } finally {
      setBusy(false);
    }
  };

  if (!ready || skipped) return null;

  return (
    <div
      className={cn(
        "mt-4 rounded-2xl border p-4",
        done
          ? "border-[var(--color-sage)]/60 bg-[var(--color-mint)]"
          : "border-[var(--color-sage)]/50 bg-[var(--color-mint)]"
      )}
      aria-live="polite"
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <h4 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-primary">
          <Bot size={13} /> {t("smart_draft_title")}
        </h4>
        {!done && (
          <button
            type="button"
            onClick={() => setSkipped(true)}
            className="text-[10px] font-bold uppercase tracking-wider text-gray-500 hover:text-primary"
          >
            <XCircle size={11} className="mb-0.5 mr-1 inline-block" /> {t("smart_draft_skip")}
          </button>
        )}
      </div>

      {turns.length === 0 && busy && (
        <p className="flex items-center gap-2 text-[13px] text-primary/80">
          <Loader2 size={13} className="animate-spin" /> {t("smart_draft_analyzing")}
        </p>
      )}

      {turns.length > 0 && (
        <ol className="space-y-2">
          {turns.map((turn, index) => (
            <li
              key={index}
              className={cn(
                "flex gap-2 text-[13px] leading-relaxed",
                turn.role === "assistant" ? "text-primary" : "text-gray-700"
              )}
            >
              <span
                className={cn(
                  "min-w-[54px] text-[10px] font-bold uppercase tracking-wider",
                  turn.role === "assistant" ? "text-primary/70" : "text-gray-400"
                )}
              >
                {turn.role === "assistant" ? t("smart_draft_question") : "You"}
              </span>
              <span className="min-w-0 flex-1">{turn.text}</span>
            </li>
          ))}
        </ol>
      )}

      {!done && turns[turns.length - 1]?.role === "assistant" && (
        <div className="mt-3 flex gap-2">
          <input
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={t("smart_draft_answer_placeholder")}
            className="min-h-[40px] flex-1 rounded-lg border border-gray-200 bg-white px-3 text-[13px] outline-none focus:border-primary"
          />
          <button
            type="button"
            onClick={send}
            disabled={busy || !answer.trim()}
            className={cn(
              "kg-press inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-bold text-white hover:bg-primary-dark",
              (busy || !answer.trim()) && "cursor-not-allowed opacity-50"
            )}
          >
            {busy && <Loader2 size={12} className="animate-spin" />}
            Send
          </button>
        </div>
      )}

      {done && (
        <p className="mt-2 flex items-center gap-2 text-[12px] font-medium text-primary">
          <CheckCircle2 size={13} /> {t("smart_draft_complete")}
        </p>
      )}

      {verificationNote && (
        <p className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-[11px] font-medium leading-relaxed text-amber-900">
          <ShieldCheck size={12} className="mt-0.5 shrink-0 text-amber-600" />
          <span>
            <span className="font-bold uppercase tracking-wider">
              {t("smart_draft_verification_needed")}:
            </span>{" "}
            {verificationNote}
          </span>
        </p>
      )}
    </div>
  );
}
