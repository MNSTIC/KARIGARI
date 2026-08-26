"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  ClipboardCheck,
  Languages,
  Phone,
  PhoneOff,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Users,
  Volume2,
  VolumeX,
  Loader2,
  Search,
  PackageCheck,
} from "lucide-react";
import { StatCard } from "@/components/ui/StatCard";
import { AdminShell, TabBar, LiveBadge } from "@/components/AdminShell";
import {
  AssistedOnboardingModal,
  type OnboardingArtisan,
} from "@/components/AssistedOnboardingModal";
import { formatRupees, FAIR_WAGE_DROP_THRESHOLD_PCT } from "@/lib/pricing";
import { cn } from "@/lib/utils";

const POLL_MS = 15000;

/* ---- Shapes returned by /api/admin/facilitator-queue and /api/admin/cluster ---- */

interface Discrepancy {
  flagged: boolean;
  pctBelow: number;
  reason: string | null;
  fairPrice: number | null;
  acceptedPrice: number | null;
  shortfall: number;
}

interface QueueArtisan {
  id: string;
  name: string;
  mobileNumber: string | null;
  location: string | null;
  clusterName: string | null;
  craftType: string | null;
  photoUrl: string | null;
  healthScore: number | null;
}

interface QueueItem {
  id: string;
  patchId: string | null;
  craftType: string;
  status: string;
  images: string[];
  laborDays: number | null;
  rawMaterialCost: number | null;
  createdAt: string;
  catalogMethod: string | null;
  voiceLanguage: string | null;
  fairWageFloor: number | null;
  salePrice: number | null;
  askingPrice: number | null;
  resolution: "OPEN" | "INVESTIGATING" | "OVERRIDE_APPROVED";
  flagReason: string | null;
  discrepancy: Discrepancy;
  artisan: QueueArtisan;
  /* Voice QA rows carry the transcript pair as well. */
  descriptionOriginal?: string | null;
  descriptionEnglish?: string | null;
  aiGeneratedListing?: string | null;
  audioUrl?: string | null;
}

interface FacilitatorStats {
  pendingQa: number;
  activeFlags: number;
  clusterArtisans: number;
  publishedThisWeek: number;
}

interface QueuePayload {
  stats: FacilitatorStats;
  pricingQueue: QueueItem[];
  resolvedFlags: QueueItem[];
  voiceQueue: QueueItem[];
}

interface ClusterMember {
  id: string;
  name: string;
  email: string;
  accountStatus: string;
  mobileNumber: string | null;
  craftType: string | null;
  location: string | null;
  clusterName: string;
  photoUrl: string | null;
  healthScore: number | null;
  experienceYears: number | null;
  socialCategory: string | null;
  annualIncome: number | null;
  upiId: string | null;
  giTagCertified: boolean;
  itemCount: number;
  pendingCount: number;
  soldCount: number;
  voiceItems: number;
  activeFlags: number;
  earnings: number;
}

interface ClusterGroup {
  name: string;
  artisanCount: number;
  activeFlags: number;
  members: ClusterMember[];
}

interface ClusterPayload {
  artisans: ClusterMember[];
  clusters: ClusterGroup[];
  totalArtisans: number;
}

const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : "Something went wrong. Try again.";

export default function FacilitatorDashboard() {
  const router = useRouter();
  const [tab, setTab] = useState<"qa" | "cluster">("qa");
  const [queue, setQueue] = useState<QueuePayload | null>(null);
  const [cluster, setCluster] = useState<ClusterPayload | null>(null);
  const [isRefreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [isOnboardingOpen, setOnboardingOpen] = useState(false);
  const [onboardArtisanId, setOnboardArtisanId] = useState<string | undefined>();
  const [clusterSearch, setClusterSearch] = useState("");

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [queueRes, clusterRes] = await Promise.all([
        fetch("/api/admin/facilitator-queue", { cache: "no-store" }),
        fetch("/api/admin/cluster", { cache: "no-store" }),
      ]);

      // One ADMIN role gates both dashboards — anything else goes back to login.
      if (queueRes.status === 401 || queueRes.status === 403) {
        router.replace("/login");
        return;
      }

      const queueJson = await queueRes.json();
      if (queueJson.success) setQueue(queueJson.data);

      if (clusterRes.ok) {
        const clusterJson = await clusterRes.json();
        if (clusterJson.success) setCluster(clusterJson.data);
      }
    } catch (e) {
      console.error("Facilitator load failed", e);
    } finally {
      setRefreshing(false);
    }
  }, [router]);

  useEffect(() => {
    const kickoff = setTimeout(load, 0);
    const interval = setInterval(load, POLL_MS);
    return () => {
      clearTimeout(kickoff);
      clearInterval(interval);
    };
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const resolveFlag = async (itemId: string, action: "APPROVE_OVERRIDE" | "INVESTIGATE") => {
    setBusyId(itemId);
    try {
      const res = await fetch("/api/admin/resolve-flag", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not update the flag.");
      setToast(
        action === "APPROVE_OVERRIDE"
          ? "Override approved. Flag cleared and written to the audit ledger."
          : "Listing held for investigation. Logged to the audit ledger."
      );
      await load();
    } catch (e) {
      setToast(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  /**
   * QA approval. There is no separate "publish" step any more — verify-batch
   * attaches the Patch ID and lists the item with the artisan's own English
   * description in the same transaction.
   */
  const approveItem = async (itemId: string) => {
    setBusyId(itemId);
    try {
      const res = await fetch("/api/admin/verify-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIds: [itemId] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not approve the listing.");
      setToast(
        "Translation approved. Patch ID attached and the listing went live with the artisan's own description."
      );
      await load();
    } catch (e) {
      setToast(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  const stats = queue?.stats;

  const onboardingArtisans: OnboardingArtisan[] = useMemo(
    () =>
      (cluster?.artisans || []).map((a: ClusterMember) => ({
        id: a.id,
        name: a.name,
        craftType: a.craftType,
        clusterName: a.clusterName,
        location: a.location,
        mobileNumber: a.mobileNumber,
      })),
    [cluster]
  );

  const filteredClusters = useMemo(() => {
    const term = clusterSearch.trim().toLowerCase();
    if (!term) return cluster?.clusters || [];
    return (cluster?.clusters || [])
      .map((c: ClusterGroup) => ({
        ...c,
        members: c.members.filter((m: ClusterMember) =>
          [m.name, m.craftType, m.location, m.mobileNumber].some(
            (v) => typeof v === "string" && v.toLowerCase().includes(term)
          )
        ),
      }))
      .filter((c: ClusterGroup) => c.members.length > 0);
  }, [cluster, clusterSearch]);

  return (
    <AdminShell
      title="Field Facilitator"
      subtitle="Artisan protection, AI quality assurance and assisted onboarding"
      flagBadge={stats?.activeFlags}
      actions={<LiveBadge isRefreshing={isRefreshing} />}
    >
      {/* Live stat strip — every number is a real query */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          variant="admin"
          label="Pending Voice QA"
          value={stats ? stats.pendingQa : "—"}
          icon={<ClipboardCheck size={18} />}
        />
        <StatCard
          variant="admin"
          label="Active Pricing Flags"
          value={stats ? stats.activeFlags : "—"}
          icon={<ShieldAlert size={18} />}
        />
        <StatCard
          variant="admin"
          label="Artisans in Cluster"
          value={stats ? stats.clusterArtisans : "—"}
          icon={<Users size={18} />}
        />
        <StatCard
          variant="admin"
          label="Published This Week"
          value={stats ? stats.publishedThisWeek : "—"}
          icon={<PackageCheck size={18} />}
        />
      </div>

      <TabBar
        active={tab}
        onChange={(k) => setTab(k as "qa" | "cluster")}
        tabs={[
          {
            key: "qa",
            label: "Pending QA",
            icon: <ShieldCheck size={16} />,
            badge: (stats?.activeFlags || 0) + (stats?.pendingQa || 0),
          },
          { key: "cluster", label: "My Cluster", icon: <Users size={16} /> },
        ]}
      />

      {!queue ? (
        <LoadingPanel label="Loading your field queue…" />
      ) : tab === "qa" ? (
        <div className="space-y-10">
          <PricingQueue
            items={queue.pricingQueue}
            resolved={queue.resolvedFlags}
            busyId={busyId}
            onResolve={resolveFlag}
          />
          <VoiceQaCenter items={queue.voiceQueue} busyId={busyId} onApprove={approveItem} />
        </div>
      ) : (
        <ClusterTab
          clusters={filteredClusters}
          totalArtisans={cluster?.totalArtisans ?? 0}
          search={clusterSearch}
          onSearch={setClusterSearch}
          isLoading={!cluster}
          onAdd={(artisanId?: string) => {
            setOnboardArtisanId(artisanId);
            setOnboardingOpen(true);
          }}
        />
      )}

      <AssistedOnboardingModal
        isOpen={isOnboardingOpen}
        onClose={() => setOnboardingOpen(false)}
        artisans={onboardingArtisans}
        defaultArtisanId={onboardArtisanId}
        onCreated={load}
      />

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[120] bg-gray-900 text-white text-sm font-medium px-5 py-3 rounded-xl shadow-2xl max-w-[90vw] text-center">
          {toast}
        </div>
      )}
    </AdminShell>
  );
}

/* ------------------------------------------------------------------ */
/* Tier 1.1 — Anti-Exploitation Pricing Queue                          */
/* ------------------------------------------------------------------ */

function PricingQueue({
  items,
  resolved,
  busyId,
  onResolve,
}: {
  items: QueueItem[];
  resolved: QueueItem[];
  busyId: string | null;
  onResolve: (id: string, action: "APPROVE_OVERRIDE" | "INVESTIGATE") => void;
}) {
  return (
    <section>
      <SectionHeader
        icon={<ShieldAlert size={20} className="text-red-500" />}
        title="Anti-Exploitation Pricing Queue"
        description={`Listings where the accepted price fell more than ${FAIR_WAGE_DROP_THRESHOLD_PCT}% below the AI fair wage floor. Call the artisan before the listing goes live.`}
        count={items.length}
      />

      {items.length === 0 ? (
        <EmptyState
          icon={<BadgeCheck size={28} />}
          title="No exploitation flags open"
          body="Every accepted price in your cluster is within the fair wage tolerance."
        />
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <PricingRow key={item.id} item={item} busyId={busyId} onResolve={onResolve} />
          ))}
        </div>
      )}

      {resolved?.length > 0 && (
        <details className="mt-4 bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden group">
          <summary className="px-6 py-4 cursor-pointer hover:bg-gray-50 transition-colors text-sm font-bold text-gray-700 list-none flex items-center gap-2">
            <CheckCircle2 size={16} className="text-green-600" />
            Overrides approved ({resolved.length})
          </summary>
          <div className="divide-y divide-gray-50 border-t border-gray-100">
            {resolved.map((item) => (
              <div
                key={item.id}
                className="px-6 py-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm"
              >
                <span className="font-bold text-gray-900">{item.craftType}</span>
                <span className="text-gray-500">{item.artisan.name}</span>
                <span className="text-gray-400 font-mono text-xs">
                  {formatRupees(item.fairWageFloor)} → {formatRupees(item.salePrice ?? item.askingPrice)}
                </span>
                <span className="ml-auto text-xs font-bold text-green-700 bg-green-50 border border-green-100 px-2 py-1 rounded-full">
                  Override approved
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

function PricingRow({
  item,
  busyId,
  onResolve,
}: {
  item: QueueItem;
  busyId: string | null;
  onResolve: (id: string, action: "APPROVE_OVERRIDE" | "INVESTIGATE") => void;
}) {
  const busy = busyId === item.id;
  const pct = item.discrepancy?.pctBelow ?? 0;
  const investigating = item.resolution === "INVESTIGATING";
  const mobile = item.artisan?.mobileNumber;

  return (
    <div
      className={cn(
        "bg-white rounded-2xl shadow-card border overflow-hidden",
        investigating ? "border-amber-200" : "border-red-100"
      )}
    >
      <div className="flex flex-col lg:flex-row">
        {/* Item */}
        <div className="flex gap-4 p-5 lg:w-[38%] border-b lg:border-b-0 lg:border-r border-gray-100">
          <CraftThumb src={item.images?.[0]} alt={item.craftType} size={72} />
          <div className="min-w-0">
            <h4 className="font-bold text-gray-900 leading-tight">{item.craftType}</h4>
            <p className="text-xs text-gray-500 font-mono mt-0.5">
              {item.patchId || `#${String(item.id).substring(0, 8)}`}
            </p>
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              <span
                className={cn(
                  "text-[10px] font-bold px-2 py-0.5 rounded-full border",
                  investigating
                    ? "bg-amber-50 text-amber-700 border-amber-200"
                    : "bg-red-50 text-red-700 border-red-200"
                )}
              >
                {investigating ? "On hold — investigating" : `⚑ ${pct}% below fair wage`}
              </span>
              {item.catalogMethod && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-200">
                  {item.catalogMethod === "VOICE" ? `Voice · ${item.voiceLanguage || "—"}` : "Manual"}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Price comparison */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-5 lg:w-[36%] border-b lg:border-b-0 lg:border-r border-gray-100">
          <PriceCell label="AI Fair Price" value={formatRupees(item.fairWageFloor)} />
          <PriceCell
            label={item.salePrice === null ? "Artisan's Price" : "Accepted Price"}
            value={formatRupees(item.salePrice ?? item.askingPrice)}
            tone="danger"
          />
          <PriceCell
            label="Shortfall"
            value={formatRupees(item.discrepancy?.shortfall)}
            tone="danger"
          />
        </div>

        {/* Artisan + actions */}
        <div className="p-5 lg:w-[26%] flex flex-col gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
              Artisan
            </p>
            <p className="font-bold text-gray-900 text-sm leading-tight">{item.artisan?.name}</p>
            <p className="text-xs text-gray-500">
              {item.artisan?.clusterName || item.artisan?.location || "Cluster unassigned"}
            </p>
          </div>

          {mobile ? (
            <a
              href={`tel:${mobile}`}
              className="flex items-center justify-center gap-2 bg-primary hover:bg-primary-dark text-white px-3 py-2.5 rounded-xl text-sm font-bold transition-colors"
            >
              <Phone size={15} />
              Call to verify · {mobile}
            </a>
          ) : (
            <div className="flex items-center justify-center gap-2 bg-gray-100 text-gray-500 px-3 py-2.5 rounded-xl text-xs font-bold">
              <PhoneOff size={15} />
              No mobile number on file
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => onResolve(item.id, "APPROVE_OVERRIDE")}
              disabled={busy}
              className="flex-1 flex items-center justify-center gap-1.5 bg-white border border-gray-200 hover:border-green-300 hover:bg-green-50 text-gray-700 hover:text-green-700 px-3 py-2 rounded-xl text-xs font-bold transition-all disabled:opacity-50"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              Approve Override
            </button>
            <button
              onClick={() => onResolve(item.id, "INVESTIGATE")}
              disabled={busy || investigating}
              className="flex-1 flex items-center justify-center gap-1.5 bg-white border border-gray-200 hover:border-amber-300 hover:bg-amber-50 text-gray-700 hover:text-amber-700 px-3 py-2 rounded-xl text-xs font-bold transition-all disabled:opacity-50"
            >
              <AlertTriangle size={14} />
              {investigating ? "On hold" : "Investigate"}
            </button>
          </div>
        </div>
      </div>

      {item.flagReason && (
        <div
          className={cn(
            "px-5 py-2.5 text-xs font-medium border-t",
            investigating
              ? "bg-amber-50/60 text-amber-800 border-amber-100"
              : "bg-red-50/60 text-red-800 border-red-100"
          )}
        >
          {item.flagReason}
        </div>
      )}
    </div>
  );
}

function PriceCell({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "danger";
}) {
  return (
    <div
      className={cn(
        "rounded-xl p-3 border",
        tone === "danger" ? "bg-red-50/60 border-red-100" : "bg-gray-50 border-gray-100"
      )}
    >
      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1 leading-tight">
        {label}
      </p>
      <p
        className={cn(
          "font-bold text-base",
          tone === "danger" ? "text-red-700" : "text-gray-900"
        )}
      >
        {value}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tier 1.2 — Voice QA Center                                          */
/* ------------------------------------------------------------------ */

function VoiceQaCenter({
  items,
  busyId,
  onApprove,
}: {
  items: QueueItem[];
  busyId: string | null;
  onApprove: (id: string) => void;
}) {
  return (
    <section>
      <SectionHeader
        icon={<Languages size={20} className="text-blue-500" />}
        title="Voice QA Center"
        description="Human-in-the-loop check on the AI translation. Compare what the artisan actually said against the English listing before it is published."
        count={items.length}
      />

      {items.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 size={28} />}
          title="Nothing waiting for review"
          body="Every voice-catalogued listing in your cluster has been checked and published."
        />
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <VoiceQaCard key={item.id} item={item} busy={busyId === item.id} onApprove={onApprove} />
          ))}
        </div>
      )}
    </section>
  );
}

function VoiceQaCard({
  item,
  busy,
  onApprove,
}: {
  item: QueueItem;
  busy: boolean;
  onApprove: (id: string) => void;
}) {
  const hasAudio = Boolean(item.audioUrl);

  return (
    <div className="bg-white rounded-2xl shadow-card border border-gray-100 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-center gap-3 bg-gray-50/60">
        <CraftThumb src={item.images?.[0]} alt={item.craftType} size={44} rounded="rounded-lg" />
        <div className="min-w-0">
          <h4 className="font-bold text-gray-900 leading-tight">{item.craftType}</h4>
          <p className="text-xs text-gray-500">
            {item.artisan?.name} · {item.artisan?.clusterName || item.artisan?.location || "Cluster"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 ml-auto">
          <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
            {item.catalogMethod === "MANUAL" ? "Typed" : `Voice · ${item.voiceLanguage || "Unknown"}`}
          </span>
          <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-gray-100 text-gray-600 border border-gray-200">
            AI floor {formatRupees(item.fairWageFloor)}
          </span>
          {/* Approving IS publishing: the listing goes live with the artisan's
              own description in the same request. No second button. */}
          <button
            onClick={() => onApprove(item.id)}
            disabled={busy}
            className="flex items-center gap-2 bg-primary hover:bg-primary-dark text-white px-4 py-2 rounded-xl text-sm font-bold transition-colors disabled:opacity-50"
            title="Approves the translation, attaches a Patch ID and lists the item automatically"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            Approve QA
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-gray-100">
        {/* Column 1 — original audio */}
        <div className="p-5">
          <ColumnLabel>Original Audio</ColumnLabel>
          {hasAudio ? (
            <div className="flex items-center gap-2">
              <Volume2 size={16} className="text-primary shrink-0" />
              <audio controls src={item.audioUrl || undefined} className="w-full max-w-full">
                Your browser cannot play this recording.
              </audio>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4">
              <div className="flex items-center gap-2 text-gray-400 mb-2">
                <VolumeX size={16} />
                <span className="text-xs font-bold uppercase tracking-wider">
                  Audio not captured
                </span>
              </div>
              {/* Kept visible and disabled so the review flow reads identically
                  whether or not the recording was persisted. */}
              <audio controls className="w-full opacity-40 pointer-events-none" aria-disabled>
                Audio unavailable.
              </audio>
              <p className="text-[11px] text-gray-500 mt-2 leading-relaxed">
                This listing was catalogued before audio retention was switched on. Review the
                transcript instead.
              </p>
            </div>
          )}
        </div>

        {/* Column 2 — raw regional transcript */}
        <div className="p-5">
          <ColumnLabel>
            Raw Transcript
            <span className="ml-1.5 text-primary">
              {item.voiceLanguage && item.voiceLanguage !== "English"
                ? `(${item.voiceLanguage})`
                : ""}
            </span>
          </ColumnLabel>
          <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap break-words">
            {item.descriptionOriginal || (
              <span className="italic text-gray-400">No transcript recorded.</span>
            )}
          </p>
        </div>

        {/* Column 3 — final AI English */}
        <div className="p-5">
          <ColumnLabel>Final AI English</ColumnLabel>
          <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap break-words">
            {item.descriptionEnglish || item.aiGeneratedListing || (
              <span className="italic text-gray-400">No English listing generated.</span>
            )}
          </p>
          {item.aiGeneratedListing && item.descriptionEnglish && (
            <p className="text-xs text-gray-500 leading-relaxed mt-3 pt-3 border-t border-gray-100">
              <span className="font-bold uppercase tracking-wider text-[10px] text-gray-400 block mb-1">
                Marketplace copy
              </span>
              {item.aiGeneratedListing}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tier 1 — My Cluster                                                 */
/* ------------------------------------------------------------------ */

function ClusterTab({
  clusters,
  totalArtisans,
  search,
  onSearch,
  isLoading,
  onAdd,
}: {
  clusters: ClusterGroup[];
  totalArtisans: number;
  search: string;
  onSearch: (v: string) => void;
  isLoading: boolean;
  onAdd: (artisanId?: string) => void;
}) {
  if (isLoading) return <LoadingPanel label="Loading your cluster roster…" />;

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-5">
        <div>
          <h3 className="text-lg font-serif font-bold text-gray-900">My Cluster</h3>
          <p className="text-sm text-gray-500">
            {totalArtisans} artisan{totalArtisans === 1 ? "" : "s"} across {clusters.length} cluster
            {clusters.length === 1 ? "" : "s"}. Contact details are unmasked so you can reach them.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center bg-gray-100 rounded-full px-4 py-2 border border-gray-200 focus-within:ring-2 focus-within:ring-primary/20 focus-within:bg-white transition-all">
            <Search size={16} className="text-gray-400 shrink-0" />
            <input
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Search artisans…"
              className="bg-transparent border-none focus:outline-none text-sm ml-2 w-40 sm:w-56 placeholder:text-gray-400"
            />
          </div>
          <button
            onClick={() => onAdd()}
            className="flex items-center gap-2 bg-primary hover:bg-primary-dark text-white px-4 py-2.5 rounded-xl text-sm font-bold transition-colors shadow-sm"
          >
            <Plus size={16} />
            Add Product on Behalf of Artisan
          </button>
        </div>
      </div>

      {clusters.length === 0 ? (
        <EmptyState
          icon={<Users size={28} />}
          title="No artisans match"
          body="Clear the search to see everyone in your cluster."
        />
      ) : (
        <div className="space-y-6">
          {clusters.map((c) => (
            <div
              key={c.name}
              className="bg-white rounded-2xl shadow-card border border-gray-100 overflow-hidden"
            >
              <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/60 flex flex-wrap items-center gap-3">
                <h4 className="font-bold text-gray-900">{c.name}</h4>
                <span className="text-xs text-gray-500">
                  {c.members.length} artisan{c.members.length === 1 ? "" : "s"}
                </span>
                {c.activeFlags > 0 && (
                  <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-red-50 text-red-700 border border-red-100">
                    {c.activeFlags} open flag{c.activeFlags === 1 ? "" : "s"}
                  </span>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[760px]">
                  <thead>
                    <tr className="bg-white border-b border-gray-100 text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                      <th className="py-3 px-6">Artisan</th>
                      <th className="py-3 px-6">Mobile</th>
                      <th className="py-3 px-6 text-center">Health</th>
                      <th className="py-3 px-6 text-center">Items</th>
                      <th className="py-3 px-6 text-center">Voice</th>
                      <th className="py-3 px-6 text-right">Earned</th>
                      <th className="py-3 px-6 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {c.members.map((m) => (
                      <tr key={m.id} className="hover:bg-gray-50/60 transition-colors">
                        <td className="py-4 px-6">
                          <div className="flex items-center gap-3">
                            <CraftThumb
                              src={m.photoUrl}
                              alt={m.name}
                              size={36}
                              rounded="rounded-full"
                            />
                            <div className="min-w-0">
                              <p className="font-bold text-gray-900 text-sm leading-tight">
                                {m.name}
                              </p>
                              <p className="text-xs text-gray-500 truncate">
                                {m.craftType || "Craft"} · {m.location || "—"}
                              </p>
                            </div>
                            {m.activeFlags > 0 && (
                              <span className="ml-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-100 shrink-0">
                                {m.activeFlags} ⚑
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-4 px-6">
                          {m.mobileNumber ? (
                            <a
                              href={`tel:${m.mobileNumber}`}
                              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                            >
                              <Phone size={13} />
                              {m.mobileNumber}
                            </a>
                          ) : (
                            <span className="text-xs text-gray-400 italic">Not on file</span>
                          )}
                        </td>
                        <td className="py-4 px-6 text-center">
                          <HealthPill score={m.healthScore} />
                        </td>
                        <td className="py-4 px-6 text-center text-sm font-bold text-gray-900">
                          {m.itemCount}
                          {m.pendingCount > 0 && (
                            <span className="block text-[10px] font-medium text-amber-600">
                              {m.pendingCount} pending
                            </span>
                          )}
                        </td>
                        <td className="py-4 px-6 text-center text-sm text-gray-600">
                          {m.itemCount > 0
                            ? `${Math.round((m.voiceItems / m.itemCount) * 100)}%`
                            : "—"}
                        </td>
                        <td className="py-4 px-6 text-right text-sm font-bold text-gray-900">
                          {formatRupees(m.earnings)}
                        </td>
                        <td className="py-4 px-6 text-right">
                          <button
                            onClick={() => onAdd(m.id)}
                            className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-600 hover:text-primary border border-gray-200 hover:border-primary/40 px-3 py-1.5 rounded-lg transition-all whitespace-nowrap"
                          >
                            <Plus size={13} />
                            Add on behalf
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */

function SectionHeader({
  icon,
  title,
  description,
  count,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  count: number;
}) {
  return (
    <div className="mb-5">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <h3 className="text-lg font-serif font-bold text-gray-900">{title}</h3>
        <span className="text-xs font-bold bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full border border-gray-200">
          {count}
        </span>
      </div>
      <p className="text-sm text-gray-500 max-w-3xl leading-relaxed">{description}</p>
    </div>
  );
}

function ColumnLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">{children}</p>
  );
}

function HealthPill({ score }: { score: number | null }) {
  if (score === null || score === undefined) {
    return <span className="text-xs text-gray-400">—</span>;
  }
  const tone =
    score >= 80
      ? "bg-green-50 text-green-700 border-green-100"
      : score >= 65
        ? "bg-amber-50 text-amber-700 border-amber-100"
        : "bg-red-50 text-red-700 border-red-100";
  return (
    <span className={cn("text-[11px] font-bold px-2 py-1 rounded-full border", tone)}>
      {Math.round(score)}
    </span>
  );
}

function CraftThumb({
  src,
  alt,
  size = 64,
  rounded = "rounded-xl",
}: {
  src?: string | null;
  alt: string;
  size?: number;
  rounded?: string;
}) {
  const resolved = src || "/ikat_saree.jpg";
  return (
    <div
      className={cn("relative overflow-hidden bg-gray-100 border border-gray-200 shrink-0", rounded)}
      style={{ width: size, height: size }}
    >
      <Image
        src={resolved}
        alt={alt}
        fill
        sizes={`${size}px`}
        className="object-cover"
        unoptimized={resolved.startsWith("data:")}
      />
    </div>
  );
}

function EmptyState({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-card p-10 text-center">
      <div className="w-14 h-14 rounded-full bg-green-50 text-green-600 flex items-center justify-center mx-auto mb-3">
        {icon}
      </div>
      <h4 className="font-bold text-gray-900 mb-1">{title}</h4>
      <p className="text-sm text-gray-500 max-w-md mx-auto">{body}</p>
    </div>
  );
}

function LoadingPanel({ label }: { label: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-card p-12 flex flex-col items-center gap-3">
      <Loader2 size={24} className="animate-spin text-primary" />
      <p className="text-sm font-medium text-gray-500">{label}</p>
    </div>
  );
}
