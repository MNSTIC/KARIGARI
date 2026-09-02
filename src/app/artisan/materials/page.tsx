"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MapPin,
  Phone,
  ExternalLink,
  ShieldCheck,
  Boxes,
  Loader2,
  RefreshCw,
  AlertTriangle,
  Users,
  BookOpen,
} from "lucide-react";
import { useLanguage } from "@/lib/translations";
import { Shell } from "@/components/ui/AppShell";
import { PageLede, PageTitle } from "@/components/ui/SectionEyebrow";
import { Card } from "@/components/ui/Card";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { Badge } from "@/components/ui/Badge";
import { SegmentedToggle } from "@/components/ui/SegmentedToggle";

/**
 * The raw-material hub.
 *
 * Rows come from `/api/artisan/generate-materials`, which merges a curated
 * directory of the material families this craft actually buys with whatever the
 * Groq sourcing route can add for the artisan's own cluster. The curated half is
 * always there, so an unconfigured or rate-limited key thins the list rather
 * than emptying the tab.
 *
 * Both halves carry `sample: true`: the materials, districts and price bands are
 * true to the trade, but the business names and numbers are illustrative, and
 * the caveat under the list says so. Nothing here is a supplier KARIGARI has
 * verified, and the page must never imply otherwise.
 *
 * The Restock / Bulk buy toggle filters that same list — it does not switch to a
 * second, invented dataset, and when nothing matches the page says so.
 */

interface Material {
  name?: string;
  price?: string;
  description?: string;
  supplier?: string;
  location?: string;
  contact?: string;
  isVerified?: boolean;
  /** Some rows come back with a bulk/MOQ note; used to split the two modes. */
  bulk?: boolean;
  minOrder?: string;
  source?: "curated" | "ai";
  /** Name and number are illustrative rather than a verified listing. */
  sample?: boolean;
}

type Mode = "restock" | "bulk";

export default function MaterialsPage() {
  const { t, language } = useLanguage();
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [craftName, setCraftName] = useState("Your Craft");
  const [mode, setMode] = useState<Mode>("restock");
  /** Set when the AI half could not be reached; the curated half still renders. */
  const [degraded, setDegraded] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Two strings, one tiny query — not the whole dashboard payload.
      const dbRes = await fetch('/api/artisan/profile-lite', { cache: 'no-store' });
      const dbData = await dbRes.json();

      const craftType = dbData?.craftType || "General Crafts";
      const clusterName = dbData?.clusterName || "Local Artisan Cluster";
      setCraftName(craftType);

      const res = await fetch('/api/artisan/generate-materials', {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ craftType, clusterName, language })
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.data) && data.data.length > 0) {
        setMaterials(data.data);
        // A thinned list is not a failed one: the notice sits above a list that
        // still rendered, rather than replacing it with an error card.
        setDegraded(typeof data.degraded === "string" ? data.degraded : null);
      } else {
        // Never render a fabricated row: say plainly that nothing loaded.
        setMaterials([]);
        setDegraded(null);
        setError(data?.error || t('materials_load_failed'));
      }
    } catch (e) {
      console.error(e);
      setMaterials([]);
      setDegraded(null);
      setError(t('materials_load_failed'));
    } finally {
      setLoading(false);
    }
    // `t` is read inside but deliberately not a dependency: the fetch only
    // needs to re-run when the language changes, and listing it here would
    // re-create this callback on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  useEffect(() => {
    // Deferred by a macrotask so the effect body performs no synchronous
    // setState — the same kickoff pattern the other artisan pages use.
    const kickoff = setTimeout(fetchData, 0);
    return () => clearTimeout(kickoff);
  }, [fetchData]);

  /**
   * Bulk rows are the ones the sourcing route flagged or gave a minimum order
   * for. Restock is everything else — one list, two views, no invented second
   * dataset.
   */
  const visible = useMemo(
    () =>
      materials.filter((mat) =>
        mode === "bulk" ? Boolean(mat.bulk || mat.minOrder) : !(mat.bulk || mat.minOrder)
      ),
    [materials, mode]
  );

  const verifiedCount = materials.filter((mat) => mat.isVerified !== false).length;

  return (
    <Shell>
      <div className="mb-9">
        <PageTitle>{t("page_raw_materials_title")}</PageTitle>
        <PageLede>
          Sourcing leads for {craftName}, with what each material should cost near your cluster.
        </PageLede>
      </div>

      <SegmentedToggle
        ariaLabel="Sourcing mode"
        value={mode}
        onChange={setMode}
        className="mb-7"
        options={[
          { value: "restock", label: "Restock", icon: <Boxes size={14} /> },
          { value: "bulk", label: "Bulk buy", icon: <Users size={14} /> },
        ]}
      />

      <SectionLabel
        action={
          <button
            onClick={fetchData}
            disabled={loading}
            className="kg-press text-[11px] font-bold text-primary hover:underline flex items-center gap-1.5 disabled:opacity-50 min-h-[32px]"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        }
      >
        {t("materials_directory")}{" "}
        {materials.length > 0 &&
          `· ${t("materials_count")
            .replace("{n}", String(visible.length))
            .replace("{total}", String(materials.length))}`}
      </SectionLabel>

      {degraded && !loading && !error && (
        <Card tone="muted" className="mb-4 flex items-start gap-3">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-gray-400" />
          <p className="text-[13px] leading-relaxed text-gray-600">{degraded}</p>
        </Card>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <Card key={i}>
              <div className="h-5 w-2/3 rounded kg-shimmer mb-3" />
              <div className="h-3 w-full rounded kg-shimmer mb-1.5" />
              <div className="h-3 w-4/5 rounded kg-shimmer mb-5" />
              <div className="h-10 w-full rounded-xl kg-shimmer" />
            </Card>
          ))}
        </div>
      ) : error ? (
        <Card pad="lg" className="border-dashed text-center">
          <AlertTriangle size={26} className="mx-auto mb-3 text-gray-400" />
          <p className="font-bold text-gray-900 mb-1">{t('materials_load_failed')}</p>
          <p className="text-sm text-gray-500 mb-6">{error}</p>
          <button
            onClick={fetchData}
            className="kg-press inline-flex items-center gap-2 bg-primary hover:bg-primary-dark text-white px-5 min-h-[44px] rounded-xl font-bold text-sm"
          >
            <RefreshCw size={16} /> {t('retry')}
          </button>
        </Card>
      ) : visible.length === 0 ? (
        <Card pad="lg" className="border-dashed text-center text-sm text-gray-500 italic">
          {mode === "bulk"
            ? "No bulk-buy lots came back for your craft this time."
            : "No restock suppliers came back for your craft this time."}
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 kg-stagger">
          {visible.map((mat, i) => (
            <Card key={i} className="kg-list-item flex flex-col">
              <div className="flex justify-between items-start gap-3 mb-2">
                <h3 className="font-serif font-bold text-lg text-gray-900 leading-snug min-w-0">
                  {mat.name}
                </h3>
                {mat.price && (
                  <span className="font-sans font-bold text-lg text-primary whitespace-nowrap shrink-0">
                    {mat.price}
                  </span>
                )}
              </div>

              <p className="text-sm text-gray-600 leading-relaxed mb-4">
                {mat.description || "Raw materials suitable for traditional craft making."}
              </p>

              <div className="flex items-center gap-2 flex-wrap mb-3">
                <span className="text-sm font-bold text-gray-800 truncate">{mat.supplier}</span>
                {/* "Verified" here means the material trades through a GI
                    cluster or a registered board — not that KARIGARI called
                    this business. The sample chip beside it keeps that honest. */}
                {mat.isVerified !== false && (
                  <Badge variant="success" caps icon={<ShieldCheck size={10} />}>
                    {t("materials_cluster_verified")}
                  </Badge>
                )}
                {mat.sample && (
                  <Badge variant="neutral" caps>{t("materials_sample_listing")}</Badge>
                )}
                {mat.minOrder && (
                  <Badge variant="mint" caps>MOQ {mat.minOrder}</Badge>
                )}
              </div>

              <dl className="space-y-1.5 text-xs text-gray-500 mb-5">
                <div className="flex items-center gap-2 min-w-0">
                  <MapPin size={13} className="text-gray-400 shrink-0" />
                  <span className="truncate">{mat.location}</span>
                </div>
                <div className="flex items-center gap-2 min-w-0">
                  <Phone size={13} className="text-gray-400 shrink-0" />
                  <span className="truncate">{mat.contact || "Contact details hidden"}</span>
                </div>
              </dl>

              <div className="mt-auto pt-4 border-t border-gray-100 flex gap-3">
                {/* A real `tel:` link when a number came back, and nothing
                    pretending to be one when it did not. */}
                {mat.contact ? (
                  <a
                    href={`tel:${String(mat.contact).replace(/[^\d+]/g, "")}`}
                    className="kg-press flex-1 min-h-[44px] rounded-xl border border-gray-200 font-bold text-sm text-gray-700 hover:bg-gray-50 flex items-center justify-center gap-2"
                  >
                    <Phone size={15} /> Call
                  </a>
                ) : (
                  <span className="flex-1 min-h-[44px] rounded-xl border border-dashed border-gray-200 text-xs text-gray-400 flex items-center justify-center">
                    No number listed
                  </span>
                )}
                <span className="flex-1 min-h-[44px] rounded-xl bg-[var(--color-mint)] text-primary font-bold text-xs flex items-center justify-center gap-1.5 text-center px-2">
                  <ExternalLink size={14} /> Order off-platform
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}

      {!loading && !error && materials.length > 0 && (
        <p className="mt-5 text-[11px] italic leading-relaxed text-gray-500">
          {t("materials_sample_note")}
        </p>
      )}

      <SectionLabel className="mt-9">Quality guides</SectionLabel>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card tone="muted">
          <span className="w-10 h-10 rounded-xl bg-card text-primary flex items-center justify-center mb-3">
            <BookOpen size={18} />
          </span>
          <p className="font-bold text-sm text-gray-900 mb-1">Spotting real silk</p>
          <p className="text-xs text-gray-600 leading-relaxed">
            The burn test and the sheen test, in under a minute.
          </p>
        </Card>
        <Card tone="muted">
          <span className="w-10 h-10 rounded-xl bg-card text-primary flex items-center justify-center mb-3">
            <ShieldCheck size={18} />
          </span>
          <p className="font-bold text-sm text-gray-900 mb-1">Dye fastness</p>
          <p className="text-xs text-gray-600 leading-relaxed">
            Checking colour hold before you buy a whole batch.
          </p>
        </Card>
      </div>

      {loading && (
        <p className="sr-only" role="status">
          <Loader2 className="animate-spin" size={16} /> Loading suppliers
        </p>
      )}
    </Shell>
  );
}
