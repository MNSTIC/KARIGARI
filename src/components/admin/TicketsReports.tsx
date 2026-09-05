"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { Loader2, ShieldAlert, ShieldCheck, XCircle } from "lucide-react";
import { ADMIN_POLL_MS } from "@/lib/pollingIntervals";
import { useNetworkQuality } from "@/lib/useNetworkQuality";
import { useLanguage } from "@/lib/translations";
import { cn } from "@/lib/utils";

/**
 * The admin's buyer-report console.
 *
 * Every row here is a real failed buyer scan — nothing is seeded and nothing is
 * mocked. The two photographs shown side by side are the exact pair the AI
 * compared: the artisan's original capture, snapshotted onto the ticket when it
 * was opened, and the buyer's upload.
 *
 * A verdict is irreversible for the artisan's score, so the submit button is
 * disabled while in flight and the API itself is guarded on `status = OPEN` —
 * a double click can never apply the penalty twice.
 */

type StatusFilter = "OPEN" | "RESOLVED" | "ALL";

interface TicketArtisan {
  id: string;
  name: string;
  healthScore: number | null;
  verifiedGenuineCount: number;
}

interface TicketCraftItem {
  id: string;
  patchId: string | null;
  craftType: string;
  image: string | null;
  status: string;
  artisan: TicketArtisan;
}

interface AdminTicket {
  id: string;
  patchId: string;
  demandId: string | null;
  buyerName: string;
  buyerContact: string | null;
  buyerImageUrl: string;
  artisanImageUrl: string | null;
  similarityScore: number | null;
  aiReasoning: string | null;
  status: string;
  adminNote: string | null;
  resolvedAt: string | null;
  createdAt: string;
  craftItem: TicketCraftItem;
}

/** Data URLs and streamed thumbnails both bypass the Next image optimizer. */
function unoptimizedFor(src: string): boolean {
  return src.startsWith("data:") || src.startsWith("/api/");
}

function shortDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

export function TicketsReports({ onOpenCount }: { onOpenCount?: (count: number) => void }) {
  const { t } = useLanguage();
  // Back the poll off to 45s on a 2G link rather than spending the
  // artisan-facing admin's data on a queue that rarely changes that fast.
  const network = useNetworkQuality();

  const [filter, setFilter] = useState<StatusFilter>("OPEN");
  const [tickets, setTickets] = useState<AdminTicket[] | null>(null);
  const [failed, setFailed] = useState(false);
  /** Which ticket is mid-submit — also the double-click guard. */
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  /** Per-ticket verdict selection and note, before submission. */
  const [drafts, setDrafts] = useState<
    Record<string, { verdict: "GUILTY" | "NOT_GUILTY" | null; note: string }>
  >({});

  const load = useCallback(async () => {
    try {
      // "Resolved" is two statuses, so it is filtered client-side off the full
      // list; OPEN uses the indexed server filter.
      const query = filter === "OPEN" ? "?status=OPEN" : "";
      const res = await fetch(`/api/admin/tickets${query}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        setFailed(true);
        return;
      }
      setFailed(false);
      const rows: AdminTicket[] = data.tickets ?? [];
      setTickets(
        filter === "RESOLVED"
          ? rows.filter((row) => row.status.startsWith("RESOLVED_"))
          : rows
      );
      onOpenCount?.(Number(data.openCount) || 0);
    } catch (e) {
      console.error("Tickets load failed", e);
      setFailed(true);
    }
  }, [filter, onOpenCount]);

  // Polls on the shared admin interval. Both timers are cleared on unmount and
  // whenever the filter changes, so switching tabs never leaks an interval.
  useEffect(() => {
    const kickoff = setTimeout(load, 0);
    const interval = setInterval(load, network.pollMs || ADMIN_POLL_MS);
    return () => {
      clearTimeout(kickoff);
      clearInterval(interval);
    };
  }, [load, network.pollMs]);

  const setDraft = (id: string, patch: Partial<{ verdict: "GUILTY" | "NOT_GUILTY" | null; note: string }>) =>
    setDrafts((prev) => ({
      ...prev,
      [id]: { verdict: prev[id]?.verdict ?? null, note: prev[id]?.note ?? "", ...patch },
    }));

  const submitVerdict = async (ticket: AdminTicket) => {
    const draft = drafts[ticket.id];
    if (!draft?.verdict || submittingId) return;
    setSubmittingId(ticket.id);
    try {
      const res = await fetch(`/api/admin/tickets/${ticket.id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          verdict: draft.verdict,
          note: draft.verdict === "NOT_GUILTY" ? draft.note : undefined,
        }),
      });
      // A 409 means someone (or a second click) already resolved it. Refetching
      // is the correct response either way.
      if (!res.ok && res.status !== 409) {
        setFailed(true);
      }
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[ticket.id];
        return next;
      });
      await load();
    } catch (e) {
      console.error("Verdict failed", e);
      setFailed(true);
    } finally {
      setSubmittingId(null);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold text-gray-900">{t("tickets_console_title")}</h2>
        <p className="mt-1 text-sm text-gray-500">{t("tickets_console_lede")}</p>
      </div>

      {/* ------------------------------------------------ sub-filter */}
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["OPEN", t("tickets_filter_open")],
            ["RESOLVED", t("tickets_filter_resolved")],
            ["ALL", t("tickets_filter_all")],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              setTickets(null);
              setFilter(key);
            }}
            className={cn(
              "kg-press min-h-[38px] rounded-full px-4 text-[12px] font-bold",
              filter === key
                ? "bg-primary text-white"
                : "bg-[var(--color-pill)] text-gray-600 hover:text-gray-900"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {failed && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-800">
          {t("tickets_load_failed")}
        </p>
      )}

      {tickets === null ? (
        <div className="flex items-center justify-center rounded-2xl border border-gray-200 bg-white p-10 text-gray-400">
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : tickets.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-500">
          {t("tickets_empty")}
        </p>
      ) : (
        <ul className="space-y-5">
          {tickets.map((ticket) => {
            const draft = drafts[ticket.id] ?? { verdict: null, note: "" };
            const isOpen = ticket.status === "OPEN";
            const busy = submittingId === ticket.id;

            return (
              <li
                key={ticket.id}
                className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-card"
              >
                {/* ---------------------------- header */}
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 p-5">
                  <div className="min-w-0">
                    <p className="font-mono text-xs font-bold text-gray-500">{ticket.patchId}</p>
                    <h3 className="mt-0.5 text-base font-bold text-gray-900">
                      {ticket.craftItem.craftType}
                    </h3>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {t("tickets_buyer")}: {ticket.buyerName}
                      {ticket.buyerContact ? ` · ${ticket.buyerContact}` : ""}
                    </p>
                    <p className="text-xs text-gray-500">
                      {t("tickets_artisan")}: {ticket.craftItem.artisan.name} ·{" "}
                      {t("tickets_health_now")}: {ticket.craftItem.artisan.healthScore ?? "—"}
                    </p>
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="text-xs font-medium text-gray-400">
                      {shortDateTime(ticket.createdAt)}
                    </p>
                    {!isOpen && (
                      <span className="mt-1 inline-block rounded-full bg-[var(--color-pill)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-600">
                        {t("tickets_resolved_badge")}
                      </span>
                    )}
                  </div>
                </div>

                {/* ---------------------------- photo comparison */}
                <div className="grid gap-4 p-5 sm:grid-cols-2">
                  <figure className="min-w-0">
                    <figcaption className="mb-2 text-[11px] font-bold uppercase tracking-wider text-gray-500">
                      {t("tickets_artisan_capture")}
                    </figcaption>
                    <div className="relative aspect-square overflow-hidden rounded-xl bg-gray-100">
                      {(ticket.artisanImageUrl || ticket.craftItem.image) && (
                        <Image
                          src={(ticket.artisanImageUrl || ticket.craftItem.image) as string}
                          alt=""
                          fill
                          sizes="(min-width: 640px) 45vw, 90vw"
                          unoptimized={unoptimizedFor(
                            (ticket.artisanImageUrl || ticket.craftItem.image) as string
                          )}
                          className="object-cover"
                        />
                      )}
                    </div>
                  </figure>

                  <figure className="min-w-0">
                    <figcaption className="mb-2 text-[11px] font-bold uppercase tracking-wider text-gray-500">
                      {t("tickets_buyer_photo")}
                    </figcaption>
                    <div className="relative aspect-square overflow-hidden rounded-xl bg-gray-100">
                      <Image
                        src={ticket.buyerImageUrl}
                        alt=""
                        fill
                        sizes="(min-width: 640px) 45vw, 90vw"
                        unoptimized={unoptimizedFor(ticket.buyerImageUrl)}
                        className="object-cover"
                      />
                    </div>
                  </figure>
                </div>

                {/* ---------------------------- AI evidence */}
                <div className="border-t border-gray-100 px-5 py-4">
                  <p className="text-xs font-bold text-gray-700">
                    {t("tickets_ai_similarity")}:{" "}
                    <span className="font-sans">
                      {ticket.similarityScore === null ? "—" : `${ticket.similarityScore}%`}
                    </span>
                  </p>
                  {ticket.aiReasoning && (
                    <p className="mt-1.5 text-xs leading-relaxed text-gray-600">
                      <span className="font-bold uppercase tracking-wider text-gray-400">
                        {t("tickets_ai_reasoning")}:
                      </span>{" "}
                      {ticket.aiReasoning}
                    </p>
                  )}
                  {!isOpen && ticket.adminNote && (
                    <p className="mt-2 text-xs leading-relaxed text-gray-600">
                      <span className="font-bold uppercase tracking-wider text-gray-400">
                        {t("tickets_note_label")}:
                      </span>{" "}
                      {ticket.adminNote}
                    </p>
                  )}
                </div>

                {/* ---------------------------- verdict */}
                {isOpen && (
                  <div className="border-t border-gray-100 bg-gray-50 p-5">
                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={() => setDraft(ticket.id, { verdict: "GUILTY" })}
                        className={cn(
                          "kg-press inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl px-5 text-sm font-bold",
                          draft.verdict === "GUILTY"
                            ? "bg-[var(--color-maroon)] text-white"
                            : "border border-red-200 bg-white text-red-700 hover:bg-red-50"
                        )}
                      >
                        <ShieldAlert size={16} /> {t("tickets_verdict_guilty")}
                      </button>

                      <button
                        type="button"
                        onClick={() => setDraft(ticket.id, { verdict: "NOT_GUILTY" })}
                        className={cn(
                          "kg-press inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl px-5 text-sm font-bold",
                          draft.verdict === "NOT_GUILTY"
                            ? "bg-gray-900 text-white"
                            : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-100"
                        )}
                      >
                        <ShieldCheck size={16} /> {t("tickets_verdict_not_guilty")}
                      </button>
                    </div>

                    {draft.verdict === "NOT_GUILTY" && (
                      <label className="mt-3 block">
                        <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-gray-500">
                          {t("tickets_note_label")}
                        </span>
                        <textarea
                          rows={3}
                          value={draft.note}
                          onChange={(e) => setDraft(ticket.id, { note: e.target.value })}
                          className="w-full resize-y rounded-lg border border-gray-200 bg-white p-3 text-sm outline-none focus:border-primary"
                        />
                      </label>
                    )}

                    {draft.verdict && (
                      <button
                        type="button"
                        onClick={() => void submitVerdict(ticket)}
                        disabled={busy}
                        className={cn(
                          "kg-press mt-4 inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-bold text-white hover:bg-primary-dark",
                          busy && "cursor-not-allowed opacity-60"
                        )}
                      >
                        {busy ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : (
                          <XCircle size={16} />
                        )}
                        {t("tickets_submit_verdict")}
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
