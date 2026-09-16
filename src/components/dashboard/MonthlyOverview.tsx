import type { ReactNode } from "react";
import { formatRupees } from "@/lib/pricing";

/**
 * The dashboard's headline block: MONTHLY OVERVIEW, the earnings figure with
 * its week-over-week change, and the three metric cards beneath it.
 *
 * Dashboard-only on purpose. `HeadlineStat` / `StatTile` in
 * src/components/ui/StatTile.tsx are also used by the Earnings and Orders
 * pages, and this look belongs to the dashboard alone.
 */

type Tone = "craft" | "verify" | "schemes";

/** Card, icon tile and icon colours for each metric — soft pastels, one vivid glyph. */
const TONES: Record<Tone, { card: string; tile: string; icon: string }> = {
  craft: { card: "#F7EEE8", tile: "#FCF6F1", icon: "#B65A28" },
  verify: { card: "#EEF0EA", tile: "#E2F4E7", icon: "#1E7A46" },
  schemes: { card: "#ECEFF2", tile: "#E4EEFA", icon: "#2F6AD1" },
};

/** Handmade work in general — a hammer crossed with a chisel — not one craft's tool. */
function CraftToolsIcon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className="h-[26px] w-[26px] @min-[18rem]:h-[30px] @min-[18rem]:w-[30px]" fill={color}>
      {/* chisel: blade top-right, wooden handle bottom-left */}
      <path d="M24.6 4.2l3.2 3.2-9.9 9.9-3.2-3.2z" />
      <path d="M13.2 15.6l3.2 3.2-1.3 1.3-3.2-3.2z" opacity=".85" />
      <path d="M11.3 17.5l3.2 3.2-6.9 6.9a2.26 2.26 0 01-3.2-3.2z" />
      {/* hammer: head top-left, handle to bottom-right */}
      <path d="M6.1 5.3l4.4-2.4 3.8 3.8-1.6 1.6 1.3 1.3-2.3 2.3-1.3-1.3-1.6 1.6-3.1-3.1 1.4-1.4z" />
      <path d="M13.6 13.3l2.3-2.3 12.3 12.3a1.63 1.63 0 01-2.3 2.3z" />
      {/* a little spark of making */}
      <path d="M27.6 12.2h1.6M28.4 11.4V13M25.8 14.6l.9.9" stroke={color} strokeWidth="1" strokeLinecap="round" opacity=".6" />
    </svg>
  );
}

function VerifyDocIcon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className="h-[26px] w-[26px] @min-[18rem]:h-[30px] @min-[18rem]:w-[30px]">
      <path
        d="M9 3.5h10.2l6.3 6.3V26a2.5 2.5 0 01-2.5 2.5H9A2.5 2.5 0 016.5 26V6A2.5 2.5 0 019 3.5z"
        fill={color}
      />
      <path d="M19.2 3.5v4.8a1.5 1.5 0 001.5 1.5h4.8z" fill="#ffffff" opacity=".45" />
      <rect x="10" y="10" width="6" height="1.6" rx=".8" fill="#ffffff" opacity=".7" />
      <rect x="10" y="13.4" width="8" height="1.6" rx=".8" fill="#ffffff" opacity=".7" />
      <circle cx="16" cy="21.4" r="4.6" fill="#ffffff" />
      <path d="M13.9 21.5l1.5 1.5 2.9-3" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PeopleIcon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className="h-[26px] w-[26px] @min-[18rem]:h-[30px] @min-[18rem]:w-[30px]" fill={color}>
      <circle cx="16" cy="9.5" r="4.2" />
      <circle cx="7.6" cy="12.6" r="3" opacity=".9" />
      <circle cx="24.4" cy="12.6" r="3" opacity=".9" />
      <path d="M9.4 26.5v-3.6a6.6 6.6 0 0113.2 0v3.6z" />
      <path d="M2.8 26.5v-2.6a4.8 4.8 0 017.3-4.1 8.1 8.1 0 00-1.9 5.2v1.5z" opacity=".9" />
      <path d="M29.2 26.5v-2.6a4.8 4.8 0 00-7.3-4.1 8.1 8.1 0 011.9 5.2v1.5z" opacity=".9" />
    </svg>
  );
}

/**
 * Two balanced lines for the card label, in any language: the split point is
 * the word boundary that keeps the longer line shortest ("GOVT SCHEMES /
 * ACTIVE", not "GOVT / SCHEMES ACTIVE"). A one-word label stays on one line.
 */
function balancedLines(label: string): [string, string] | [string] {
  const words = label.trim().split(/\s+/);
  if (words.length < 2) return [label];
  let best: [string, string] = [words[0], words.slice(1).join(" ")];
  for (let i = 1; i < words.length; i += 1) {
    const candidate: [string, string] = [words.slice(0, i).join(" "), words.slice(i).join(" ")];
    if (Math.max(candidate[0].length, candidate[1].length) < Math.max(best[0].length, best[1].length)) {
      best = candidate;
    }
  }
  return best;
}

function MetricCard({
  tone,
  icon,
  value,
  label,
  note,
}: {
  tone: Tone;
  icon: ReactNode;
  value: ReactNode;
  label: string;
  note?: string | null;
}) {
  const colours = TONES[tone];
  const lines = balancedLines(label);
  return (
    <div className="@container min-w-0 rounded-[20px] px-4 py-4 sm:py-5" style={{ backgroundColor: colours.card }}>
      {/* Side by side (as in the reference) whenever the card can hold it —
          including the three-up row at a 1440 px desktop — and stacked only in
          the narrower three-up column between lg and xl. Sizes step up again
          once the card is roomy (a one-column phone layout). */}
      <div className="flex flex-col items-start gap-3 @min-[11.5rem]:flex-row @min-[11.5rem]:items-center @min-[18rem]:gap-4">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] @min-[18rem]:h-14 @min-[18rem]:w-14 @min-[18rem]:rounded-2xl"
          style={{ backgroundColor: colours.tile }}
        >
          {icon}
        </span>
        <div className="flex min-w-0 items-center gap-3 @min-[18rem]:gap-4">
          <span className="kg-display text-[36px] leading-none text-gray-900 @min-[18rem]:text-[46px]">{value}</span>
          <span className="min-w-0 text-[11.5px] font-medium uppercase leading-[1.35] tracking-[0.04em] text-gray-700 @min-[18rem]:text-[13.5px] @min-[18rem]:tracking-[0.05em]">
            {lines.map((line, index) => (
              <span key={index} className="block whitespace-nowrap">
                {line}
              </span>
            ))}
            {note && <span className="mt-0.5 block text-[10.5px] normal-case tracking-normal text-gray-500">{note}</span>}
          </span>
        </div>
      </div>
    </div>
  );
}

export interface MonthlyOverviewProps {
  t: (key: string) => string;
  totalEarnings: number;
  /** Week-over-week % change in earnings; null when last week had none. */
  earningsChangePct: number | null;
  /** "+₹1,200" — this week's earnings, shown when no percentage can be. */
  pastWeekEarnings: string | null;
  itemsSold: number;
  pendingVerifications: number;
  pendingNote?: string | null;
  schemesActive: number;
}

export function MonthlyOverview({
  t,
  totalEarnings,
  earningsChangePct,
  pastWeekEarnings,
  itemsSold,
  pendingVerifications,
  pendingNote,
  schemesActive,
}: MonthlyOverviewProps) {
  const hasPct = earningsChangePct !== null;
  const down = hasPct && earningsChangePct < 0;
  const deltaFigure = hasPct ? `${earningsChangePct > 0 ? "+" : ""}${earningsChangePct}%` : pastWeekEarnings;
  // "from last 7 days" is a comparison, so it only follows a percentage. A plain
  // rupee amount (no previous week to compare with) keeps "in the last 7 days".
  const deltaSuffix = hasPct ? t("overview_from_last_7_days") : t("delta_last_7_days").replace("{amount}", "").trim();

  return (
    <div>
      <p className="text-[13px] font-semibold uppercase tracking-[0.2em] text-gray-700 sm:text-[14px]">
        {t("monthly_overview")}
      </p>

      <div className="mt-2 flex flex-wrap items-baseline gap-x-5 gap-y-1">
        <span className="kg-display text-[48px] leading-none text-gray-900 sm:text-[64px]">
          {formatRupees(totalEarnings)}
        </span>
        {deltaFigure && (
          <span className="flex items-center gap-1.5 text-[15px] text-gray-700 sm:text-[17px]">
            <svg
              viewBox="0 0 16 16"
              width="16"
              height="16"
              aria-hidden="true"
              className={down ? "rotate-90" : undefined}
              fill="none"
              stroke={down ? "#A33A2A" : "#1B8A4A"}
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 12L12 4M6 4h6v6" />
            </svg>
            <span className="font-semibold" style={{ color: down ? "#A33A2A" : "#1B8A4A" }}>
              {deltaFigure}
            </span>
            <span>{deltaSuffix}</span>
          </span>
        )}
      </div>

      <div className="mt-7 grid grid-cols-1 gap-3.5 sm:grid-cols-3 sm:gap-4">
        <MetricCard
          tone="craft"
          icon={<CraftToolsIcon color={TONES.craft.icon} />}
          value={itemsSold}
          label={t("items_sold")}
        />
        <MetricCard
          tone="verify"
          icon={<VerifyDocIcon color={TONES.verify.icon} />}
          value={pendingVerifications}
          label={t("pending_verification_label")}
          note={pendingNote}
        />
        <MetricCard
          tone="schemes"
          icon={<PeopleIcon color={TONES.schemes.icon} />}
          value={schemesActive}
          label={t("govt_schemes_active")}
        />
      </div>
    </div>
  );
}
