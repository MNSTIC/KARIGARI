"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MessageCircle, Play, RotateCcw, Check, CheckCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/lib/translations";

/**
 * Offline-alert demo for the SMS Auto-Pilot card.
 *
 * Nothing is sent anywhere — this replays, in the app, what an artisan without
 * a smartphone would receive on WhatsApp or SMS. The script is scripted, but
 * the *content* is a real OPEN demand row when one exists for their craft.
 * Palette is KARIGARI's own; deliberately not WhatsApp green.
 */

export interface SimulationDemand {
  id: string;
  craftType: string;
  quantity: number;
  targetPriceMin: number | null;
  targetPriceMax: number | null;
  location: string | null;
  festival: string | null;
  buyerName: string | null;
}

interface Bubble {
  id: number;
  from: "buyer" | "artisan";
  text: string;
}

interface WhatsAppSimulationProps {
  craftType?: string | null;
  /** Latest matching OPEN demand. When null the script falls back to sample copy. */
  demand?: SimulationDemand | null;
  /** Message text from the artisan's latest DEMAND_ALERT notification, if any. */
  alertMessage?: string | null;
  /** WHATSAPP | SMS | IN_APP — drives the channel label in the header. */
  channel?: string | null;
  /** False when the artisan has no mobile number on file. */
  alertsActive?: boolean;
}

function formatPrice(demand: SimulationDemand): string {
  const { targetPriceMin: min, targetPriceMax: max } = demand;
  if (max) return `₹${max.toLocaleString("en-IN")}/unit`;
  if (min) return `₹${min.toLocaleString("en-IN")}/unit`;
  return "price on quote";
}

export function WhatsAppSimulation({
  craftType,
  demand,
  alertMessage,
  channel,
  alertsActive = true,
}: WhatsAppSimulationProps) {
  const { t } = useLanguage();

  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [typing, setTyping] = useState(false);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const craft = craftType || t("your_craft");

  /** The alert line: the real notification, else a line built from the real demand, else sample copy. */
  const alertLine = alertMessage
    ? `📈 ${alertMessage}`
    : demand
      ? `📈 ${t("demand_spike")}: ${demand.quantity} ${demand.craftType}${
          demand.location ? ` — ${demand.location}` : ""
        }${demand.festival ? ` (${demand.festival})` : ""}, ${formatPrice(demand)}. ${t("reply_yes_to_list")}`
      : `📈 ${t("demand_spike")}: 50 ${craft}, ₹3,800/unit. ${t("reply_yes_to_list")}`;

  const confirmLine = demand
    ? `✅ ${t("listed_on_ondc")} — ${demand.quantity} ${demand.craftType} · ${
        demand.buyerName || t("verified_buyer")
      }`
    : `✅ ${t("listed_on_ondc")}`;

  const run = () => {
    clearTimers();
    setBubbles([]);
    setDone(false);
    setRunning(true);
    setTyping(true);

    const push = (bubble: Bubble) => setBubbles((prev) => [...prev, bubble]);
    const at = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));

    at(1200, () => {
      setTyping(false);
      push({ id: 1, from: "buyer", text: alertLine });
    });
    at(2600, () => push({ id: 2, from: "artisan", text: "YES" }));
    at(3200, () => setTyping(true));
    at(4400, () => {
      setTyping(false);
      push({ id: 3, from: "buyer", text: confirmLine });
    });
    at(5600, () => {
      push({
        id: 4,
        from: "buyer",
        text: `🔒 ${t("fair_price_locked")}`,
      });
      setRunning(false);
      setDone(true);
    });
  };

  const reset = () => {
    clearTimers();
    setBubbles([]);
    setTyping(false);
    setRunning(false);
    setDone(false);
  };

  const channelLabel =
    channel === "SMS" ? "SMS" : channel === "IN_APP" ? t("in_app_alert") : "WhatsApp";

  return (
    <div className="rounded-2xl border border-gray-200 overflow-hidden bg-white">
      {/* Chat header — KARIGARI dark green, never WhatsApp green */}
      <div className="bg-primary px-4 py-3 flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-[var(--color-mint)] flex items-center justify-center shrink-0">
          <MessageCircle size={18} className="text-primary" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-bold text-white truncate">KARIGARI {t("alerts")}</div>
          <div className="text-[11px] text-white/70 truncate">
            {channelLabel} · {alertsActive ? t("alerts_active") : t("alerts_inactive")}
          </div>
        </div>
        <span className="ml-auto text-[10px] font-bold uppercase tracking-wider bg-white/15 text-white px-2 py-1 rounded-full shrink-0">
          {t("simulation")}
        </span>
      </div>

      {/* Transcript */}
      <div className="px-4 py-4 bg-[var(--color-background)] min-h-[190px] space-y-3">
        {bubbles.length === 0 && !typing && (
          <p className="text-xs text-gray-500 text-center py-10 leading-relaxed">
            {t("sim_idle_hint")}
          </p>
        )}

        {bubbles.map((bubble) => (
          <div
            key={bubble.id}
            className={cn(
              "flex animate-fade-in-up",
              bubble.from === "artisan" ? "justify-end" : "justify-start"
            )}
          >
            <div
              className={cn(
                "max-w-[85%] px-3 py-2 rounded-2xl text-xs leading-relaxed shadow-sm",
                bubble.from === "artisan"
                  ? "bg-primary text-white rounded-br-sm"
                  : "bg-[var(--color-mint)] text-primary rounded-bl-sm border border-[var(--color-sage)]/40"
              )}
            >
              <p className="whitespace-pre-wrap break-words">{bubble.text}</p>
              {bubble.from === "artisan" && (
                <span className="flex justify-end mt-0.5 text-white/70">
                  <CheckCheck size={12} />
                </span>
              )}
            </div>
          </div>
        ))}

        {typing && (
          <div className="flex justify-start animate-fade-in-up">
            <div className="bg-[var(--color-mint)] border border-[var(--color-sage)]/40 px-4 py-3 rounded-2xl rounded-bl-sm flex gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="px-4 py-3 border-t border-gray-100 bg-white flex items-center gap-3">
        <button
          onClick={run}
          disabled={running}
          className="flex items-center gap-2 bg-primary hover:bg-primary-dark disabled:opacity-50 text-white text-sm font-bold px-4 py-2.5 rounded-xl transition-colors"
        >
          {done ? <RotateCcw size={16} /> : <Play size={16} />}
          {running ? t("sim_running") : done ? t("sim_replay") : t("run_simulation")}
        </button>
        {(bubbles.length > 0 || typing) && (
          <button
            onClick={reset}
            className="text-xs font-bold text-gray-500 hover:text-gray-800 transition-colors"
          >
            {t("sim_clear")}
          </button>
        )}
        <span className="ml-auto text-[10px] text-gray-400 font-medium text-right leading-tight">
          {demand ? t("sim_using_live_demand") : t("sim_using_sample")}
        </span>
      </div>

      {/* Honesty line — nothing is actually sent anywhere */}
      <div className="px-4 pb-3 bg-white">
        <p className="text-[10px] text-gray-400 leading-relaxed flex items-start gap-1.5">
          <Check size={11} className="shrink-0 mt-0.5" />
          {t("sim_disclaimer")}
        </p>
      </div>
    </div>
  );
}
