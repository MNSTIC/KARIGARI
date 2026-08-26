"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip as RechartsTooltip,
  Legend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
import {
  Activity,
  AlertTriangle,
  Banknote,
  CheckCircle2,
  Download,
  FileText,
  Fingerprint,
  Languages,
  Link2,
  Loader2,
  Mic,
  Search,
  ShieldCheck,
  TrendingUp,
  Users,
} from "lucide-react";
import { StatCard } from "@/components/ui/StatCard";
import { AdminShell, TabBar, LiveBadge } from "@/components/AdminShell";
import { formatRupees } from "@/lib/pricing";
import { cn } from "@/lib/utils";

const POLL_MS = 15000;

/* ---- Shapes returned by /api/admin/nodal-analytics and /api/admin/audit-trace ---- */

interface ChartDatum {
  name: string;
  value: number;
  color: string;
}

/** Distributions also carry their share of the whole. */
interface DistributionDatum extends ChartDatum {
  pct: number;
}

interface WageClusterRow {
  name: string;
  baseline: number;
  withKarigari: number;
  increasePct: number;
  artisans: number;
}

interface NodalStats {
  totalArtisans: number;
  totalItems: number;
  voiceAdoptionPct: number;
  languagesInUse: number;
  avgWageIncreasePct: number;
  activeFlags: number;
  compliancePct: number;
  totalDisbursed: number;
  totalAuditEvents: number;
  clustersCovered: number;
}

interface NodalAnalyticsData {
  stats: NodalStats;
  catalogMethodData: ChartDatum[];
  languageData: DistributionDatum[];
  wage: {
    avgWageIncreasePct: number;
    artisansCounted: number;
    totalBaseline: number;
    totalUplift: number;
    chart: WageClusterRow[];
  };
  communityData: DistributionDatum[];
  fairWage: { compliant: number; belowFloor: number; compliancePct: number; pricedItems: number };
}

interface LedgerEntry {
  id: string;
  createdAt: string;
  patchId: string | null;
  craftType: string | null;
  actorRole: string;
  action: string;
  hash: string;
}

interface ChainEntry {
  id: string;
  action: string;
  actorRole: string;
  comments: string | null;
  createdAt: string;
  hash: string;
  previousHash: string | null;
}

interface TraceItem {
  id: string;
  patchId: string | null;
  craftType: string;
  status: string;
  createdAt: string;
  fairWageFloor: number | null;
  salePrice: number | null;
  pricingFlag: boolean;
  catalogMethod: string | null;
  voiceLanguage: string | null;
  artisanName: string | null;
  cluster: string | null;
  location: string | null;
}

interface TraceableRef {
  patchId: string;
  craftType: string;
  status: string;
  createdAt: string;
}

interface TracePayload {
  query: string;
  item: TraceItem | null;
  notFound?: boolean;
  chain?: ChainEntry[];
  ledger: LedgerEntry[];
  traceable: TraceableRef[];
}

export default function NodalDashboard() {
  const router = useRouter();
  const [tab, setTab] = useState<"impact" | "audit">("impact");
  const [analytics, setAnalytics] = useState<NodalAnalyticsData | null>(null);
  const [isRefreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/admin/nodal-analytics", { cache: "no-store" });
      if (res.status === 401 || res.status === 403) {
        router.replace("/login");
        return;
      }
      const json = await res.json();
      if (json.success) setAnalytics(json.data);
    } catch (e) {
      console.error("Nodal analytics load failed", e);
    } finally {
      setRefreshing(false);
    }
  }, [router]);

  useEffect(() => {
    // Deferred by a macrotask so the effect body performs no synchronous setState.
    const kickoff = setTimeout(load, 0);
    const interval = setInterval(load, POLL_MS);
    return () => {
      clearTimeout(kickoff);
      clearInterval(interval);
    };
  }, [load]);

  const stats = analytics?.stats;

  return (
    <AdminShell
      title="Central Nodal Officer"
      subtitle="Digital inclusion impact and tamper-evident traceability — aggregate view, no artisan PII"
      actions={
        <div className="flex items-center gap-3">
          <LiveBadge isRefreshing={isRefreshing} />
          <a
            href="/api/admin/export-compliance"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 text-sm font-bold bg-primary hover:bg-primary-dark text-white px-4 py-2 rounded-lg transition-colors shadow-sm"
          >
            <Download size={15} />
            <span className="hidden sm:inline">Export Report</span>
          </a>
        </div>
      }
    >
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          variant="admin"
          label="Voice Adoption"
          value={stats ? `${stats.voiceAdoptionPct}%` : "—"}
          icon={<Mic size={18} />}
          trend={stats ? `${stats.totalItems} listings` : undefined}
        />
        <StatCard
          variant="admin"
          label="Languages In Use"
          value={stats ? stats.languagesInUse : "—"}
          icon={<Languages size={18} />}
          trend={stats ? `${stats.clustersCovered} clusters` : undefined}
        />
        <StatCard
          variant="admin"
          label="Avg Wage Increase"
          value={stats ? `+${stats.avgWageIncreasePct}%` : "—"}
          icon={<TrendingUp size={18} />}
          trend="vs baseline income"
        />
        <StatCard
          variant="admin"
          label="Fair-Wage Compliance"
          value={stats ? `${stats.compliancePct}%` : "—"}
          icon={<ShieldCheck size={18} />}
          trend={stats ? `${stats.activeFlags} open flags` : undefined}
        />
      </div>

      <TabBar
        active={tab}
        onChange={(k) => setTab(k as "impact" | "audit")}
        tabs={[
          { key: "impact", label: "Impact Analytics", icon: <Activity size={16} /> },
          { key: "audit", label: "Global Audit", icon: <Fingerprint size={16} /> },
        ]}
      />

      {tab === "impact" ? (
        !analytics ? (
          <LoadingPanel label="Computing impact metrics…" />
        ) : (
          <ImpactAnalytics data={analytics} />
        )
      ) : (
        <GlobalAudit onUnauthorized={() => router.replace("/login")} />
      )}
    </AdminShell>
  );
}

/* ------------------------------------------------------------------ */
/* Tier 2.1 — Digital Inclusion Impact Metrics                         */
/* ------------------------------------------------------------------ */

/** Cluster names are long ("Pochampally Weavers Cooperative"); axis ticks are not. */
function shortClusterName(name: string) {
  const words = String(name).split(/\s+/);
  const short = words.slice(0, 2).join(" ");
  return short.length > 16 ? `${short.slice(0, 15)}…` : short;
}

function ImpactAnalytics({ data }: { data: NodalAnalyticsData }) {
  const { catalogMethodData, languageData, wage, communityData, fairWage, stats } = data;
  const hasItems = stats.totalItems > 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Cataloging method */}
        <ChartCard
          title="Cataloging Method"
          subtitle="Voice capture versus manual typing. The literacy barrier, measured."
        >
          {hasItems ? (
            <div className="flex flex-col sm:flex-row items-center gap-4 h-full">
              <div className="relative w-full sm:w-1/2 h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={catalogMethodData}
                      cx="50%"
                      cy="50%"
                      innerRadius={58}
                      outerRadius={88}
                      paddingAngle={2}
                      dataKey="value"
                      stroke="none"
                    >
                      {catalogMethodData.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <RechartsTooltip formatter={(v, n) => [`${v} listings`, n]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-3xl font-serif font-bold text-gray-900">
                    {stats.voiceAdoptionPct}%
                  </span>
                  <span className="text-[11px] text-gray-500 font-medium">via Voice</span>
                </div>
              </div>
              <div className="w-full sm:w-1/2 space-y-3">
                {catalogMethodData.map((entry) => (
                  <LegendRow
                    key={entry.name}
                    color={entry.color}
                    label={entry.name}
                    value={`${entry.value} listing${entry.value === 1 ? "" : "s"}`}
                  />
                ))}
                <p className="text-xs text-gray-500 leading-relaxed pt-2 border-t border-gray-100">
                  Voice cataloguing lets an artisan who cannot read or type list a product on their
                  own terms.
                </p>
              </div>
            </div>
          ) : (
            <NoData label="No listings catalogued yet." />
          )}
        </ChartCard>

        {/* Language distribution */}
        <ChartCard
          title="Language Distribution"
          subtitle="Regional languages the platform is actually being used in."
        >
          {hasItems ? (
            <div className="flex flex-col sm:flex-row items-center gap-4 h-full">
              <div className="w-full sm:w-1/2 h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={languageData}
                      cx="50%"
                      cy="50%"
                      outerRadius={88}
                      paddingAngle={2}
                      dataKey="value"
                      stroke="none"
                    >
                      {languageData.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <RechartsTooltip formatter={(v, n) => [`${v} listings`, n]} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="w-full sm:w-1/2 space-y-3">
                {languageData.map((entry) => (
                  <LegendRow
                    key={entry.name}
                    color={entry.color}
                    label={entry.name}
                    value={`${entry.pct}%`}
                  />
                ))}
              </div>
            </div>
          ) : (
            <NoData label="No language data recorded yet." />
          )}
        </ChartCard>
      </div>

      {/* Wage increase */}
      <ChartCard
        title="Average Wage Increase"
        subtitle={`Declared baseline annual income against income after KARIGARI earnings, averaged per cluster across ${wage.artisansCounted} artisan${wage.artisansCounted === 1 ? "" : "s"} with a recorded baseline.`}
        headerRight={
          <div className="text-right">
            <p className="text-3xl font-serif font-bold text-primary leading-none">
              +{wage.avgWageIncreasePct}%
            </p>
            <p className="text-[11px] text-gray-500 font-medium mt-1">
              {formatRupees(wage.totalUplift)} paid out
            </p>
          </div>
        }
      >
        {wage.chart.length > 0 ? (
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={wage.chart} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#ECE6E2" />
                <XAxis
                  dataKey="name"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#6B635E", fontSize: 10 }}
                  interval={0}
                  height={64}
                  angle={-20}
                  textAnchor="end"
                  tickFormatter={shortClusterName}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#6B635E", fontSize: 11 }}
                  tickFormatter={(v: number) => `₹${Math.round(v / 1000)}k`}
                  width={50}
                />
                <RechartsTooltip
                  formatter={(v, n) => [
                    formatRupees(Number(v)),
                    n === "baseline" ? "Baseline income" : "With KARIGARI",
                  ]}
                />
                <Legend
                  formatter={(v: string) => (v === "baseline" ? "Baseline income" : "With KARIGARI")}
                  wrapperStyle={{ fontSize: 12 }}
                />
                <Bar dataKey="baseline" fill="#DCD4CE" radius={[6, 6, 0, 0]} />
                <Bar dataKey="withKarigari" fill="#24332C" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <NoData label="No artisan has a recorded baseline income yet." />
        )}
      </ChartCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* MoSJE community breakdown */}
        <ChartCard
          title="Community Breakdown (MoSJE)"
          subtitle="Registered artisans by declared social category."
        >
          {communityData.length > 0 ? (
            <div className="space-y-3 pt-1">
              {communityData.map((c) => (
                <div key={c.name} className="flex items-center gap-3 text-xs">
                  <span className="w-16 font-bold text-gray-600 shrink-0">{c.name}</span>
                  <div className="flex-grow bg-gray-100 h-2.5 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${Math.max(c.pct, 2)}%`, backgroundColor: c.color }}
                    />
                  </div>
                  <span className="w-24 text-right font-medium text-gray-500 shrink-0">
                    {c.value} · {c.pct}%
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <NoData label="No social category data recorded yet." />
          )}
        </ChartCard>

        {/* Fair wage compliance */}
        <ChartCard
          title="Fair-Wage Compliance"
          subtitle="Settled sales measured against the AI fair wage floor."
        >
          {fairWage.pricedItems > 0 ? (
            <div className="space-y-4 pt-1">
              <div className="flex items-end gap-3">
                <span className="text-5xl font-serif font-bold text-gray-900 leading-none">
                  {fairWage.compliancePct}%
                </span>
                <span className="text-sm text-gray-500 pb-1">
                  of {fairWage.pricedItems} settled sale
                  {fairWage.pricedItems === 1 ? "" : "s"} met or beat the floor
                </span>
              </div>
              <div className="w-full bg-red-100 h-3 rounded-full overflow-hidden">
                <div
                  className="bg-primary h-3 rounded-full transition-all"
                  style={{ width: `${fairWage.compliancePct}%` }}
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <MiniStat
                  icon={<CheckCircle2 size={14} className="text-green-600" />}
                  label="At or above floor"
                  value={fairWage.compliant}
                />
                <MiniStat
                  icon={<AlertTriangle size={14} className="text-red-500" />}
                  label="Below floor"
                  value={fairWage.belowFloor}
                />
                <MiniStat
                  icon={<Banknote size={14} className="text-gray-500" />}
                  label="Disbursed"
                  value={formatRupees(stats.totalDisbursed)}
                />
              </div>
              <p className="text-xs text-gray-500 leading-relaxed pt-2 border-t border-gray-100">
                {stats.activeFlags} listing{stats.activeFlags === 1 ? " is" : "s are"} currently held
                by the anti-exploitation guardian for facilitator review.
              </p>
            </div>
          ) : (
            <NoData label="No settled sales to measure yet." />
          )}
        </ChartCard>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500 bg-white border border-gray-100 rounded-2xl shadow-card px-6 py-4">
        <span className="flex items-center gap-1.5">
          <Users size={14} /> {stats.totalArtisans} artisans registered
        </span>
        <span className="flex items-center gap-1.5">
          <FileText size={14} /> {stats.totalAuditEvents} immutable ledger events
        </span>
        <span className="flex items-center gap-1.5">
          <Banknote size={14} /> {formatRupees(stats.totalDisbursed)} paid to artisans
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tier 2.2 — Traceability & Hash-Ledger Oversight                     */
/* ------------------------------------------------------------------ */

function GlobalAudit({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [result, setResult] = useState<TracePayload | null>(null);
  const [isLoading, setLoading] = useState(true);

  const run = useCallback(
    async (q: string) => {
      setLoading(true);
      try {
        const res = await fetch(`/api/admin/audit-trace?q=${encodeURIComponent(q)}`, {
          cache: "no-store",
        });
        if (res.status === 401 || res.status === 403) {
          onUnauthorized();
          return;
        }
        const json = await res.json();
        if (json.success) setResult(json.data);
      } catch (e) {
        console.error("Audit trace failed", e);
      } finally {
        setLoading(false);
      }
    },
    [onUnauthorized]
  );

  useEffect(() => {
    const kickoff = setTimeout(() => run(""), 0);
    return () => clearTimeout(kickoff);
  }, [run]);

  const search = (q: string) => {
    setQuery(q);
    setSubmitted(q);
    run(q);
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-6">
        <div className="flex items-center gap-2 mb-1">
          <Fingerprint size={20} className="text-primary" />
          <h3 className="text-lg font-serif font-bold text-gray-900">
            Tamper-Evident Digital Passport
          </h3>
        </div>
        <p className="text-sm text-gray-500 mb-5 max-w-3xl leading-relaxed">
          Enter any Patch ID or Product ID to replay its immutable hash chain — Created, Verified by
          the facilitator, then Sold. Each event carries a ledger hash linked to the one before it.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            search(query.trim());
          }}
          className="flex flex-col sm:flex-row gap-3"
        >
          <div className="flex items-center bg-gray-100 rounded-xl px-4 py-3 border border-gray-200 focus-within:ring-2 focus-within:ring-primary/20 focus-within:bg-white transition-all flex-grow">
            <Search size={16} className="text-gray-400 shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. PATCH-LAK-001"
              className="bg-transparent border-none focus:outline-none text-sm ml-2 w-full placeholder:text-gray-400 font-mono"
            />
          </div>
          <button
            type="submit"
            className="bg-primary hover:bg-primary-dark text-white px-6 py-3 rounded-xl text-sm font-bold transition-colors shrink-0"
          >
            Trace product
          </button>
          {submitted && (
            <button
              type="button"
              onClick={() => search("")}
              className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-5 py-3 rounded-xl text-sm font-bold transition-colors shrink-0"
            >
              Clear
            </button>
          )}
        </form>

        {result && result.traceable.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-gray-100">
            <span className="text-[11px] font-bold uppercase tracking-widest text-gray-400">
              Recent passports
            </span>
            {result.traceable.map((t) => (
              <button
                key={t.patchId}
                onClick={() => search(t.patchId)}
                className="text-xs font-mono font-bold px-2.5 py-1 rounded-lg bg-gray-100 hover:bg-primary hover:text-white text-gray-600 border border-gray-200 transition-all"
              >
                {t.patchId}
              </button>
            ))}
          </div>
        )}
      </div>

      {isLoading ? (
        <LoadingPanel label="Reading the ledger…" />
      ) : (
        <>
          {submitted && result?.notFound && (
            <div className="bg-white rounded-2xl border border-amber-200 shadow-card p-8 text-center">
              <AlertTriangle size={28} className="text-amber-500 mx-auto mb-3" />
              <h4 className="font-bold text-gray-900 mb-1">No passport found</h4>
              <p className="text-sm text-gray-500">
                Nothing on the ledger matches{" "}
                <span className="font-mono font-bold">{submitted}</span>.
              </p>
            </div>
          )}

          {result?.item && <HashChain item={result.item} chain={result.chain || []} />}

          <RawLedger ledger={result?.ledger || []} />
        </>
      )}
    </div>
  );
}

function HashChain({ item, chain }: { item: TraceItem; chain: ChainEntry[] }) {
  return (
    <div className="bg-white rounded-2xl shadow-card border border-primary/20 ring-2 ring-primary/10 overflow-hidden">
      <div className="px-6 py-5 border-b border-gray-100 bg-gray-50/60 flex flex-wrap items-center gap-4">
        <div className="min-w-0">
          <p className="font-mono font-bold text-gray-900 text-lg">{item.patchId || item.id}</p>
          <p className="text-sm text-gray-500">
            {item.craftType} · {item.cluster || item.location || "Cluster unrecorded"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 ml-auto">
          <Chip label="Status" value={String(item.status).replace(/_/g, " ")} />
          <Chip label="AI floor" value={formatRupees(item.fairWageFloor)} />
          <Chip label="Sold at" value={formatRupees(item.salePrice)} />
          {item.catalogMethod && (
            <Chip
              label="Catalogued"
              value={
                item.catalogMethod === "VOICE"
                  ? `Voice · ${item.voiceLanguage || "—"}`
                  : "Manual"
              }
            />
          )}
          {item.pricingFlag && (
            <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-red-50 text-red-700 border border-red-100">
              ⚑ Pricing flag open
            </span>
          )}
        </div>
      </div>

      <div className="p-6">
        <div className="relative border-l-2 border-gray-100 ml-3 pl-8 space-y-6">
          {chain.length === 0 && (
            <p className="text-sm text-gray-400 italic">No ledger events recorded.</p>
          )}
          {chain.map((log, idx) => (
            <div key={log.id} className="relative">
              <div
                className={cn(
                  "absolute -left-[43px] top-0.5 w-6 h-6 rounded-full border-2 bg-white flex items-center justify-center",
                  eventTone(log.action).ring
                )}
              >
                {eventTone(log.action).icon}
              </div>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <p className="text-sm font-bold text-gray-900">
                  {log.action.replace(/_/g, " ")}
                </p>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-200">
                  {log.actorRole}
                </span>
                <span className="text-xs text-gray-500">
                  {new Date(log.createdAt).toLocaleString("en-IN")}
                </span>
                <span className="text-[10px] font-bold text-gray-400 ml-auto">
                  Block {idx + 1} of {chain.length}
                </span>
              </div>
              {log.comments && (
                <p
                  className={cn(
                    "text-sm p-3 rounded-xl border mt-2 inline-block leading-relaxed",
                    eventTone(log.action).box
                  )}
                >
                  {log.comments}
                </p>
              )}
              <div className="mt-2 flex flex-col sm:flex-row sm:items-center gap-x-3 gap-y-1 text-[11px] font-mono">
                {log.previousHash && (
                  <span className="text-gray-400 flex items-center gap-1">
                    <Link2 size={11} />
                    prev {log.previousHash}
                  </span>
                )}
                <span className="text-gray-700 font-bold select-all">{log.hash}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function RawLedger({ ledger }: { ledger: LedgerEntry[] }) {
  return (
    <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-6">
      <div className="flex flex-wrap justify-between items-center gap-3 mb-4 pb-4 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <FileText size={20} className="text-blue-500" />
          <h3 className="text-lg font-serif font-bold text-gray-900">Global Raw Ledger</h3>
        </div>
        <span className="text-xs font-mono bg-gray-100 px-2 py-1 rounded text-gray-600">
          LIVE SYNC · {ledger.length} events
        </span>
      </div>

      {ledger.length === 0 ? (
        <NoData label="No ledger events yet." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm min-w-[720px]">
            <thead>
              <tr className="bg-gray-50 text-gray-500 uppercase tracking-wider text-xs border-b border-gray-100">
                <th className="p-3 font-medium">Timestamp</th>
                <th className="p-3 font-medium">Patch ID</th>
                <th className="p-3 font-medium">Actor</th>
                <th className="p-3 font-medium">Action</th>
                <th className="p-3 font-medium text-right">Ledger Hash</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {ledger.map((log) => (
                <tr key={log.id} className="hover:bg-gray-50 font-mono text-xs">
                  <td className="p-3 text-gray-500 whitespace-nowrap">
                    {new Date(log.createdAt).toLocaleString("en-IN")}
                  </td>
                  <td className="p-3 font-bold text-gray-900">{log.patchId || "N/A"}</td>
                  <td className="p-3">
                    <span
                      className={cn(
                        "px-2 py-1 rounded-md",
                        log.actorRole === "ADMIN"
                          ? "bg-purple-100 text-purple-700"
                          : log.actorRole === "ARTISAN"
                            ? "bg-blue-100 text-blue-700"
                            : "bg-gray-100 text-gray-700"
                      )}
                    >
                      {log.actorRole}
                    </span>
                  </td>
                  <td className="p-3 text-gray-700">{log.action.replace(/_/g, " ")}</td>
                  <td className="p-3 text-right text-gray-400 select-all">{log.hash}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */

function eventTone(action: string) {
  if (action.includes("FLAG"))
    return {
      ring: "border-red-300",
      box: "bg-red-50 border-red-200 text-red-800",
      icon: <AlertTriangle size={13} className="text-red-500" />,
    };
  if (action.includes("VERIFIED"))
    return {
      ring: "border-green-300",
      box: "bg-green-50 border-green-200 text-green-900",
      icon: <ShieldCheck size={13} className="text-green-600" />,
    };
  if (action.includes("PAYMENT") || action.includes("DISBURS"))
    return {
      ring: "border-green-400",
      box: "bg-green-100 border-green-300 text-green-900",
      icon: <Banknote size={13} className="text-green-700" />,
    };
  if (action.includes("OVERRIDE"))
    return {
      ring: "border-amber-300",
      box: "bg-amber-50 border-amber-200 text-amber-900",
      icon: <CheckCircle2 size={13} className="text-amber-600" />,
    };
  return {
    ring: "border-blue-300",
    box: "bg-blue-50 border-blue-200 text-blue-900",
    icon: <FileText size={13} className="text-blue-500" />,
  };
}

function ChartCard({
  title,
  subtitle,
  headerRight,
  children,
}: {
  title: string;
  subtitle: string;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-6 flex flex-col">
      <div className="flex justify-between items-start gap-4 mb-4">
        <div>
          <h3 className="text-lg font-serif font-bold text-gray-900 leading-tight">{title}</h3>
          <p className="text-xs text-gray-500 mt-1 max-w-xl leading-relaxed">{subtitle}</p>
        </div>
        {headerRight}
      </div>
      <div className="flex-grow">{children}</div>
    </div>
  );
}

function LegendRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <span className="text-gray-700 font-medium">{label}</span>
      <span className="ml-auto text-gray-500 font-bold">{value}</span>
    </div>
  );
}

function MiniStat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
}) {
  return (
    <div className="bg-gray-50 border border-gray-100 rounded-xl p-3">
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 leading-tight">
          {label}
        </span>
      </div>
      <p className="font-bold text-gray-900 text-sm">{value}</p>
    </div>
  );
}

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-white text-gray-700 border border-gray-200">
      <span className="text-gray-400 uppercase tracking-wider">{label} </span>
      {value}
    </span>
  );
}

function NoData({ label }: { label: string }) {
  return (
    <div className="h-[180px] flex items-center justify-center text-sm text-gray-400 italic">
      {label}
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
