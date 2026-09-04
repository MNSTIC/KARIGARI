"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowRight, ArrowUpRight, Camera, CheckCircle2, Globe2, Loader2,
  QrCode, X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useLanguage } from "@/lib/translations";
import { formatRupees, getListingPrice } from "@/lib/pricing";
import { Card } from "@/components/ui/Card";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { SectionEyebrow, SectionHeading } from "@/components/ui/SectionEyebrow";
import { Badge, PatchIdChip, statusBadge } from "@/components/ui/Badge";
import { HeadlineStat, StatTile } from "@/components/ui/StatTile";
import { ProgressStepper } from "@/components/ui/ProgressStepper";
import { BandMarker, ProgressBar } from "@/components/ui/ProgressBar";
import { Shell } from "@/components/ui/AppShell";
import { ESCROW_HELD, STAGE1_ADVANCE_PAID_40, STAGE2_SETTLED_89 } from "@/lib/escrow";
import { setArtisanIdentity } from "@/lib/artisanIdentity";
import { cn } from "@/lib/utils";

/**
 * Modals are code-split out of the first paint.
 *
 * Every one of these was imported eagerly into the dashboard bundle even though
 * none of them renders until the artisan opens it — CaptureModal alone is ~44 KB
 * before its dependencies. `ssr: false` because they are all interaction-only.
 */
const CaptureModal = dynamic(
  () => import("@/components/CaptureModal").then((m) => m.CaptureModal),
  { ssr: false }
);
const AgentHandoffModal = dynamic(
  () => import("@/components/AgentHandoffModal").then((m) => m.AgentHandoffModal),
  { ssr: false }
);
const DisputeModal = dynamic(
  () => import("@/components/DisputeModal").then((m) => m.DisputeModal),
  { ssr: false }
);
const ProfileEditorModal = dynamic(
  () => import("@/components/ProfileEditorModal").then((m) => m.ProfileEditorModal),
  { ssr: false }
);
const CompleteDraftModal = dynamic(
  () => import("@/components/CompleteDraftModal").then((m) => m.CompleteDraftModal),
  { ssr: false }
);
const QrAttachModal = dynamic(
  () => import("@/components/QrAttachModal").then((m) => m.QrAttachModal),
  { ssr: false }
);

/** Escrow stage -> stepper index. Read-only: nothing here can advance a stage. */
const SETTLEMENT_STEP_KEYS = ["step_sold", "step_shipped", "step_settled"];
function settlementStage(escrowStatus: string | null | undefined): number {
  if (escrowStatus === STAGE2_SETTLED_89) return 2;
  if (escrowStatus === STAGE1_ADVANCE_PAID_40) return 1;
  if (escrowStatus === ESCROW_HELD) return 0;
  return -1;
}

/** "2 days ago" — the reference's upload stamp, from the row's real createdAt. */
function relativeDays(iso: string | null | undefined): string {
  if (!iso) return "";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
}

const ACTIVE_SCHEME_STATUSES = new Set(["APPLIED", "UNDER_REVIEW", "APPROVED", "DISBURSED"]);

export default function ArtisanDashboard() {
  const router = useRouter();
  const { t } = useLanguage();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSellModalOpen, setIsSellModalOpen] = useState(false);
  const [isCrossCheckModalOpen, setIsCrossCheckModalOpen] = useState(false);
  const [isDisputeModalOpen, setIsDisputeModalOpen] = useState(false);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  /** The IVR voice draft the artisan is finishing, if any. */
  const [draftItem, setDraftItem] = useState<any>(null);
  const [isProfileEditorOpen, setIsProfileEditorOpen] = useState(false);
  /** The item whose physical QR patch is being attached and verified. */
  const [qrItem, setQrItem] = useState<any>(null);
  /** Per-row in-flight state for the List on ONDC action. */
  const [listingId, setListingId] = useState<string | null>(null);
  /** In-app banner for the listing action - never a browser alert. */
  const [listNotice, setListNotice] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);

  const [dashboardData, setDashboardData] = useState<any>(null);
  const [selectedItem, setSelectedItem] = useState<any>(null);
  /* The dispute and agent-handoff flows are opened from elsewhere in the app;
     the dashboard only owns the closing side of them. */
  const [selectedDisputeItem] = useState<any>(null);

  const fetchDashboardData = async () => {
    try {
      const res = await fetch('/api/artisan/dashboard', { cache: 'no-store' });
      if (res.status === 401 || res.status === 403) {
        await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
        router.push('/login');
        return;
      }
      const data = await res.json();
      if (data.success) {
        setDashboardData(data.data);
        // This page loads the richest copy of the profile, so it becomes the
        // authority for the shell's header avatar. Without this the header
        // would keep showing the stale photo after a profile edit.
        setArtisanIdentity({
          name: data.data?.artisanName || "",
          photoUrl: data.data?.artisanProfile?.photoUrl || null,
          craftType: data.data?.artisanProfile?.craftType || "",
          clusterName: data.data?.artisanProfile?.clusterName || "",
          location: data.data?.artisanProfile?.location || "",
        });
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  // A capture queued offline becomes a real row only once the sync provider has
  // POSTed it. Without this the artisan comes back online, the upload succeeds,
  // and the dashboard still shows nothing until they reload by hand.
  useEffect(() => {
    const onFlushed = () => { void fetchDashboardData(); };
    window.addEventListener('karigari:queue-flushed', onFlushed);
    return () => window.removeEventListener('karigari:queue-flushed', onFlushed);
  }, []);

  // The installed app's "Capture" home-screen shortcut lands here with
  // `?capture=1`. Same URL-reading pattern as the profile deep link below, and
  // the param is dropped so a refresh does not reopen the modal.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("capture") !== "1") return;

    const kickoff = setTimeout(() => {
      setIsModalOpen(true);
      params.delete("capture");
      const query = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (query ? `?${query}` : ""));
    }, 0);
    return () => clearTimeout(kickoff);
  }, []);

  // Autonomous assistant (F5): the voice route emits
  // `karigari:assistant-action` on the window; this is the dashboard's half.
  // Only modal opens are handled here — navigate actions are already routed by
  // the assistant itself before the event fires.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { type?: string }
        | undefined;
      if (!detail) return;
      if (detail.type === "OPEN_CAPTURE") setIsModalOpen(true);
      if (detail.type === "OPEN_PROFILE") setIsProfileEditorOpen(true);
    };
    window.addEventListener("karigari:assistant-action", handler);
    return () => window.removeEventListener("karigari:assistant-action", handler);
  }, []);

  // Deep link from the insights map and from the shell's profile button. Read
  // straight off the URL rather than via useSearchParams so this fully-client
  // page needs no Suspense boundary, and drop the param so a refresh does not
  // reopen it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("edit") !== "profile") return;

    // Deferred by a macrotask so the effect body performs no synchronous
    // setState. The URL is rewritten inside the callback, not beside it:
    // StrictMode runs this effect twice in dev, and stripping the param on the
    // first pass (whose timer the cleanup then cancels) left the second pass
    // with nothing to act on.
    const kickoff = setTimeout(() => {
      setIsProfileEditorOpen(true);
      params.delete("edit");
      const query = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (query ? `?${query}` : ""));
    }, 0);
    return () => clearTimeout(kickoff);
  }, []);

  /**
   * Publish one capture to the ONDC channels.
   *
   * Gated on SELLABLE: an item is only sellable once the artisan has attached
   * the physical QR patch and the AI has matched the re-photographed piece to
   * the original capture. Listing before that would put something on the
   * marketplace that carries no verifiable patch.
   */
  const listOnOndc = async (item: any) => {
    if (item.status !== 'SELLABLE') {
      setListNotice({ tone: 'warn', text: t('list_requires_sellable') });
      return;
    }
    setListingId(item.id);
    setListNotice(null);
    try {
      const res = await fetch('/api/artisan/syndicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          craftItemId: item.id,
          targetPlatforms: ['ONDC_PAYTM', 'ONDC_MAGICPIN'],
        }),
      });
      const data = await res.json();
      if (data?.success) {
        setListNotice({ tone: 'ok', text: t('list_success') });
        await fetchDashboardData();
      } else {
        setListNotice({ tone: 'warn', text: data?.error || t('list_failed') });
      }
    } catch (e) {
      console.error('List on ONDC failed:', e);
      setListNotice({ tone: 'warn', text: t('list_failed') });
    } finally {
      setListingId(null);
    }
  };

  const handleModalClose = () => {
    setIsModalOpen(false);
    fetchDashboardData();
  };

  const captures: any[] = useMemo(
    () => dashboardData?.recentCaptures || [],
    [dashboardData]
  );

  /**
   * The three figures beside the headline.
   *
   * Items sold and active schemes are exact totals from the API. Pending
   * verification is counted across `recentCaptures`, which the API caps at the
   * ten most recent rows — so the tile says which set it is describing rather
   * than presenting a partial count as a lifetime one.
   */
  const tiles = useMemo(() => {
    const pending = captures.filter((c) => c.status === "PENDING_VERIFICATION").length;
    const schemes = (dashboardData?.schemeApplications ?? []).filter((a: any) =>
      ACTIVE_SCHEME_STATUSES.has(String(a?.status || "").toUpperCase())
    ).length;
    const capped = (dashboardData?.myCapturesCount ?? 0) > captures.length;
    return { pending, schemes, capped };
  }, [captures, dashboardData]);

  /** Items that have actually entered escrow — the Live Settlements column. */
  const settlements = useMemo(
    () => captures.filter((item) => settlementStage(item.escrowStatus) >= 0).slice(0, 4),
    [captures]
  );

  return (
    <Shell>
      {/* ============================================ Overview + capture */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-10">
        <div className="kg-enter min-w-0">
          <HeadlineStat
            eyebrow={t("monthly_overview")}
            value={formatRupees(dashboardData?.totalEarnings ?? 0)}
            deltaIcon={<ArrowUpRight size={15} className="text-[var(--color-rust)]" />}
            delta={
              dashboardData?.trends?.earnings
                ? t("delta_last_7_days").replace("{amount}", dashboardData.trends.earnings)
                : undefined
            }
          />

          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatTile
              label={t("items_sold")}
              value={dashboardData?.itemsSold ?? 0}
              icon={<Image src="/icons/items-sold.jpg" alt="" width={28} height={28} className="mix-blend-multiply" />}
            />
            <StatTile
              label={t("pending_verification_label")}
              value={tiles.pending}
              delta={tiles.capped ? t("of_your_10_recent") : null}
              icon={<Image src="/icons/pending-verification.jpg" alt="" width={28} height={28} className="mix-blend-multiply" />}
            />
            <StatTile
              label={t("govt_schemes_active")}
              value={tiles.schemes}
              icon={<Image src="/icons/govt-schemes.jpg" alt="" width={28} height={28} className="mix-blend-multiply" />}
            />
          </div>
        </div>

        {/* The reference's stacked-shadow card. The offset layer is a hard
            box-shadow so it costs no extra element and never affects layout. */}
        <div className="kg-enter kg-offset flex flex-col rounded-3xl bg-[var(--color-gray-100)] p-7 text-center">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-white">
            <Camera size={26} strokeWidth={1.6} />
          </span>
          <h2 className="kg-display mt-6 text-[26px] leading-tight text-gray-900">
            {t("capture_new_craft")}
          </h2>
          <p className="mt-2.5 text-[14px] leading-relaxed text-gray-600">
            {t("capture_card_sub")}
          </p>
          <button
            onClick={() => setIsModalOpen(true)}
            className="kg-press kg-label mt-6 inline-flex min-h-[50px] w-full items-center justify-center rounded-xl bg-primary font-medium text-white hover:bg-primary-dark"
          >
            {t("start_capture")}
          </button>
        </div>
      </div>

      {listNotice && (
        <div
          className={cn(
            'kg-fade mt-8 rounded-xl border px-4 py-3 text-sm font-semibold',
            listNotice.tone === 'ok'
              ? 'border-green-200 bg-green-50 text-green-800'
              : 'border-orange-100 bg-orange-50 text-orange-800'
          )}
        >
          {listNotice.text}
        </div>
      )}

      {/* ============================ Live settlements + recent portfolio */}
      <div className="mt-14 grid gap-8 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] lg:gap-10">
        {/* ------------------------------------------- Live settlements */}
        <section aria-labelledby="settlements-heading">
          <SectionHeading
            id="settlements-heading"
            size="md"
            action={
              <Link
                href="/artisan/earnings"
                aria-label={t("view_all")}
                className="kg-press flex h-9 w-9 items-center justify-center rounded-full text-gray-700 hover:bg-[var(--color-pill)]"
              >
                <ArrowRight size={18} />
              </Link>
            }
          >
            {t("live_settlements")}
          </SectionHeading>

          {settlements.length === 0 ? (
            <Card tone="muted" pad="lg" className="text-[14px] leading-relaxed text-gray-500">
              Nothing is in escrow yet. When a piece sells, both tranches appear here as they are
              released — 40% on dispatch, the rest on delivery.
            </Card>
          ) : (
            <ul className="kg-stagger space-y-4">
              {settlements.map((item) => {
                const stage = settlementStage(item.escrowStatus);
                const gross = Number(item.salePrice) || getListingPrice(item) || 0;
                return (
                  <li key={item.id} className="rounded-2xl bg-[var(--color-gray-100)] p-5">
                    <div className="flex items-baseline justify-between gap-3">
                      <SectionEyebrow>
                        {item.patchId ? `Patch ${item.patchId.slice(-6)}` : `Item ${item.id.slice(0, 6).toUpperCase()}`}
                      </SectionEyebrow>
                      <span className="kg-display shrink-0 text-[18px] leading-none text-gray-900">
                        {formatRupees(gross)}
                      </span>
                    </div>

                    <p className="kg-display mt-1.5 text-[19px] leading-snug text-gray-900">
                      {item.craftType}
                    </p>

                    <ProgressStepper
                      steps={SETTLEMENT_STEP_KEYS.map(t)}
                      current={stage}
                      className="mt-5"
                    />

                    <div className="mt-4 flex items-center justify-between gap-3">
                      <p className="min-w-0 text-[12px] leading-snug text-gray-600">
                        {stage === 2
                          ? "Both tranches released to your VPA."
                          : stage === 1
                            ? "40% advance released. Final tranche on delivery."
                            : "Payment held in escrow until dispatch."}
                      </p>
                      <Badge
                        variant={stage === 2 ? "success" : "neutral"}
                        caps
                        className="shrink-0"
                        icon={stage === 2 ? <CheckCircle2 size={11} /> : undefined}
                      >
                        {stage === 2
                          ? t("settle_complete")
                          : stage === 1
                            ? t("settle_in_transit")
                            : t("settle_held")}
                      </Badge>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Direct-UPI destination. Read-only: no admin or facilitator has any
              authority over where these tranches go. */}
          <Card className="mt-5">
            <SectionLabel>Direct UPI settlement</SectionLabel>
            <dl className="space-y-2.5">
              <MiniStat label="Total gross sales" value={formatRupees(dashboardData?.totalGrossSales ?? 0)} />
              <MiniStat label="40% advances received" value={formatRupees(dashboardData?.advancesReceived ?? 0)} />
              <MiniStat label="Final settlements cleared" value={formatRupees(dashboardData?.finalSettlementsCleared ?? 0)} />
            </dl>

            {dashboardData?.upiId ? (
              <p className="mt-4 rounded-xl bg-[var(--color-pill)] px-4 py-3 text-[12px] font-semibold leading-relaxed text-gray-800">
                Direct to VPA: <span className="break-all">{dashboardData.upiId}</span> — zero
                middleman.
              </p>
            ) : (
              <button
                onClick={() => setIsProfileEditorOpen(true)}
                className="kg-press mt-4 min-h-[44px] w-full rounded-xl border border-dashed border-gray-300 px-4 py-3 text-left text-[12px] font-semibold text-gray-700 hover:bg-gray-50"
              >
                Add your UPI ID so settlements can reach you directly — tap to add it.
              </button>
            )}

            <p className="mt-4 text-[11px] leading-relaxed text-gray-500">
              Prototype: real UPI payout rails are not wired, so each
              tranche is recorded as a programmatic settlement (test) — direct to your VPA, zero
              middleman. The escrow states and the audit trail are real; the bank credit is
              simulated.
            </p>
          </Card>
        </section>

        {/* -------------------------------------------- Recent portfolio */}
        <Card as="section" pad="lg" className="kg-enter min-w-0" radius="3xl">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="kg-display text-[26px] leading-tight text-gray-900">
                {t("recent_portfolio")}
              </h2>
              <p className="mt-1.5 text-[14px] text-gray-500">
                {t("recent_portfolio_sub")}
              </p>
            </div>
            <Link
              href="/artisan/market"
              className="kg-label shrink-0 font-medium text-gray-600 hover:text-gray-900"
            >
              {t("view_all")}
            </Link>
          </div>

          <div className="mt-6 border-t border-gray-200/70">
            {captures.length === 0 ? (
              <p className="py-12 text-center text-[14px] text-gray-500">{t("table_no_data")}</p>
            ) : (
              <ul className="kg-stagger divide-y divide-gray-200/70">
                {captures.map((item) => (
                  <PortfolioRow
                    key={item.id}
                    item={item}
                    listing={listingId === item.id}
                    onList={() => listOnOndc(item)}
                    onAttach={() => setQrItem(item)}
                    onDraft={() => setDraftItem(item)}
                    onDetails={() => {
                      setSelectedItem(item);
                      setIsDetailsModalOpen(true);
                    }}
                    t={t}
                  />
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>

      {/* Logout lives in the top bar (`TopBar`), beside the language menu, so it
          is reachable from every artisan screen rather than only from the foot
          of this one. */}

      {/* MODALS
          Each is mounted only while it is open. `dynamic()` fetches a chunk when
          the component RENDERS, so leaving them mounted with isOpen={false}
          would download every modal on first paint and defeat the split. */}
      {isModalOpen && (
        <CaptureModal
          isOpen
          onClose={handleModalClose}
          artisanName={dashboardData?.artisanName}
          artisanPhotoUrl={dashboardData?.artisanProfile?.photoUrl}
        />
      )}

      {(isSellModalOpen || isCrossCheckModalOpen) && (
        <AgentHandoffModal
          isOpen
          onClose={() => { setIsSellModalOpen(false); setIsCrossCheckModalOpen(false); fetchDashboardData(); }}
          item={selectedItem}
        />
      )}

      {isDisputeModalOpen && (
        <DisputeModal isOpen onClose={() => setIsDisputeModalOpen(false)} item={selectedDisputeItem} />
      )}

      {isProfileEditorOpen && (
        <ProfileEditorModal
          isOpen
          onClose={() => setIsProfileEditorOpen(false)}
          artisanData={{ ...dashboardData?.artisanProfile, name: dashboardData?.artisanName }}
          onSaved={fetchDashboardData}
        />
      )}

      {qrItem !== null && (
        <QrAttachModal
          isOpen
          onClose={() => setQrItem(null)}
          item={qrItem}
          onVerified={fetchDashboardData}
        />
      )}

      {draftItem && (
        <CompleteDraftModal
          item={draftItem}
          onClose={() => setDraftItem(null)}
          onCompleted={() => {
            setDraftItem(null);
            fetchDashboardData();
          }}
        />
      )}

      {isDetailsModalOpen && selectedItem && (
        <DetailsModal item={selectedItem} onClose={() => { setIsDetailsModalOpen(false); setSelectedItem(null); }} />
      )}
    </Shell>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * One row of Recent Portfolio.
 *
 * The thumbnail comes from `item.thumbnail`, a single short string the dashboard
 * API derives from `images[0]`: a path where the row already stores one, and
 * otherwise the URL that streams the artisan's own base64 capture. The payload
 * still carries no photo — shipping ten base64 blobs made it multi-megabyte —
 * but every row that has a picture now shows it. A row with none (a fresh IVR
 * draft, say) gets the themed placeholder, never an empty `src`.
 */
function PortfolioRow({
  item,
  listing,
  onList,
  onAttach,
  onDraft,
  onDetails,
  t,
}: {
  item: any;
  listing: boolean;
  onList: () => void;
  onAttach: () => void;
  onDraft: () => void;
  onDetails: () => void;
  t: (key: string) => string;
}) {
  const isIvrDraft = item.status === 'IVR_DRAFT';
  const awaitingPatch = item.status === 'VERIFIED' && !item.qrVerified && item.patchId;
  const badge = isIvrDraft
    ? ({ variant: 'warning', label: t('ivr_draft') } as const)
    : statusBadge(item.status);
  const price = getListingPrice(item);

  return (
    <li className="kg-list-item py-5">
      <div className="flex gap-4">
        <CraftThumb src={item.thumbnail} alt={item.craftType} />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h3 className="kg-display min-w-0 text-[18px] leading-snug text-gray-900">
              {item.craftType}
            </h3>
            <span className="kg-display shrink-0 text-[17px] leading-none text-gray-900">
              {formatRupees(price)}
            </span>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
            {item.status === 'PENDING_VERIFICATION' ? (
              <span className="kg-label text-gray-400">ID hidden pending verification</span>
            ) : item.patchId ? (
              <PatchIdChip patchId={item.patchId} />
            ) : (
              <span className="kg-label text-gray-400">
                ITM-{item.id.substring(0, 6).toUpperCase()}
              </span>
            )}
            <span aria-hidden className="text-[10px] text-gray-300">•</span>
            <span className="kg-label text-gray-400">
              Uploaded {relativeDays(item.createdAt)}
            </span>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge variant={badge.variant} caps>{badge.label}</Badge>
            {item.isListedOnMarketplace && (
              <Badge variant="neutral" caps>Marketplace</Badge>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {!isIvrDraft &&
              (awaitingPatch ? (
                <button
                  onClick={onAttach}
                  className="kg-press inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-primary px-3.5 text-[12px] font-semibold text-white hover:bg-primary-dark"
                >
                  <QrCode size={13} /> {t('download_qr_upload_photo')}
                </button>
              ) : item.isListedOnMarketplace ? null : (
                <button
                  onClick={onList}
                  disabled={listing}
                  className="kg-press inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-gray-300 px-3.5 text-[12px] font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                >
                  {listing ? <Loader2 size={13} className="animate-spin" /> : <Globe2 size={13} />}
                  {t('list_on_ondc')}
                </button>
              ))}

            {isIvrDraft ? (
              <button
                onClick={onDraft}
                className="kg-press inline-flex min-h-[38px] items-center rounded-lg bg-primary px-3.5 text-[12px] font-semibold text-white hover:bg-primary-dark"
              >
                {t('complete_draft')}
              </button>
            ) : (
              <button
                onClick={onDetails}
                className="kg-press ml-auto min-h-[38px] px-1 text-[12px] font-semibold text-gray-900 hover:underline"
              >
                {t('view_details')}
              </button>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

/**
 * A listing's photo, or a themed stand-in when it has none.
 *
 * The guard is the point: `next/image` throws on an empty `src`, and a falsy
 * value is exactly what a just-captured item or a phone-catalogued draft has.
 * `unoptimized` for data URLs because the optimizer cannot fetch one, and it
 * would only re-encode a photo the browser already holds.
 */
function CraftThumb({ src, alt }: { src?: string | null; alt?: string }) {
  if (!src) {
    return (
      <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-[var(--color-mint)] text-primary">
        <Camera size={20} strokeWidth={1.6} />
      </span>
    );
  }

  return (
    <span className="relative block h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-[var(--color-pill)]">
      <Image
        src={src}
        alt={alt || ""}
        fill
        sizes="64px"
        unoptimized={src.startsWith("data:") || src.startsWith("/api/")}
        className="object-cover"
      />
    </span>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="kg-label font-medium text-gray-500">{label}</dt>
      <dd className="shrink-0 text-[14px] font-semibold text-gray-900">{value}</dd>
    </div>
  );
}

/**
 * What the artisan has actually been paid on one item, driven off `status`.
 *
 * An advance only becomes real in `disbursement/apply`, i.e. after an admin has
 * verified the item AND the artisan has claimed it. Every status before that
 * must read zero. The AI `fairWageFloor` is a valuation, so it may only ever be
 * shown as an *eligible* amount, never as money received.
 */
function describeArtisanMoney(item: any, t: (key: string) => string) {
  const advancePaid = Number(item?.advancePaid) || 0;
  const finalPayout = Number(item?.finalPayoutQueued) || 0;
  const eligible = Number(item?.fairWageFloor) || 0;
  const helperWith = (key: string, amount: number) =>
    t(key).replace('{amount}', formatRupees(amount));

  switch (String(item?.status || '')) {
    case 'PENDING_VERIFICATION':
      return {
        label: t('advance_received'),
        value: formatRupees(0),
        helper: helperWith('advance_helper_pending', eligible),
        received: false,
      };
    case 'VERIFIED':
    case 'TAG_ATTACHED':
      return {
        label: t('advance_received'),
        value: formatRupees(0),
        helper: helperWith('advance_helper_verified', eligible),
        received: false,
      };
    case 'SOLD_FINAL':
    case 'PAYOUT_COMPLETED':
      return {
        label: t('total_earned'),
        value: formatRupees(advancePaid + finalPayout),
        helper: `${t('advance_received')} ${formatRupees(advancePaid)} · ${t('final_payout')} ${formatRupees(finalPayout)}`,
        received: advancePaid + finalPayout > 0,
      };
    case 'SOLD_MIDDLEMAN':
      return {
        label: t('advance_received'),
        value: formatRupees(advancePaid),
        helper: t('advance_helper_middleman'),
        received: advancePaid > 0,
      };
    case 'LISTED_AUCTION':
      return {
        label: t('advance_received'),
        value: formatRupees(advancePaid),
        helper: t('advance_helper_auction'),
        received: advancePaid > 0,
      };
    default:
      // ADVANCE_PAID and anything later: the row's own number is the truth.
      return {
        label: t('advance_received'),
        value: formatRupees(advancePaid),
        helper: advancePaid > 0 ? null : helperWith('advance_helper_verified', eligible),
        received: advancePaid > 0,
      };
  }
}

function DetailsModal({ item, onClose }: { item: any, onClose: () => void }) {
  const { t } = useLanguage();
  const money = describeArtisanMoney(item, t);
  const listingPrice = getListingPrice(item);

  /**
   * The photo and the timeline are deliberately NOT in the dashboard payload —
   * they were the bulk of it. Fetch them here, for this one item, when the
   * artisan actually opens it.
   */
  const [detail, setDetail] = useState<{
    images: string[];
    auditLogs: any[];
    patchId: string | null;
    qrVerified: boolean;
    qrVerifiedImageUrl: string | null;
  } | null>(null);

  useEffect(() => {
    if (!item?.id) return;
    let cancelled = false;
    const kickoff = setTimeout(async () => {
      try {
        const res = await fetch(`/api/items/${item.id}`, { cache: 'no-store' });
        const data = await res.json();
        if (!cancelled && data?.success) {
          setDetail({
            images: data.images || [],
            auditLogs: data.auditLogs || [],
            patchId: data.patchId ?? null,
            qrVerified: data.qrVerified === true,
            qrVerifiedImageUrl: data.qrVerifiedImageUrl ?? null,
          });
        }
      } catch (e) {
        console.error('Failed to load item details:', e);
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(kickoff);
    };
  }, [item?.id]);

  // The list row only carries a thumbnail; the full photo arrives with the
  // detail fetch. Falling back to the thumbnail keeps something real on screen
  // while that request is in flight instead of flashing an unrelated saree.
  const heroImage = detail?.images?.[0] || item.thumbnail || "/ikat_saree.jpg";
  const timeline = detail?.auditLogs ?? item.auditLogs ?? null;
  /** The photo the artisan took of the piece with its printed QR patch on it. */
  const patchPhoto = detail?.qrVerified ? detail.qrVerifiedImageUrl : null;
  const patchId = detail?.patchId ?? item.patchId ?? null;
  const bandMin = Number(item.marketPriceMin) || 0;
  const bandMax = Number(item.marketPriceMax) || 0;

  return (
    <div className="kg-fade fixed inset-0 z-[110] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-card shadow-2xl sm:rounded-3xl">
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200/70 px-5 py-4 sm:px-6">
          <h2 className="kg-display text-lg text-gray-900">{t('craft_details')}</h2>
          <button
            onClick={onClose}
            aria-label={t('close_btn')}
            className="kg-press flex h-10 w-10 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100"
          >
            <X size={20} />
          </button>
        </div>

        <div className="overflow-y-auto p-5 sm:p-6">
          {/* Hero */}
          <div className="relative mb-5 aspect-[4/3] w-full overflow-hidden rounded-2xl border border-gray-200/70 bg-gray-100">
            <Image
              src={heroImage}
              alt={item.craftType}
              fill
              sizes="(max-width: 640px) 100vw, 512px"
              unoptimized={heroImage.startsWith('data:') || heroImage.startsWith('/api/')}
              className="object-cover"
            />
            <span className="absolute left-3 top-3">
              <Badge variant="solid" caps icon={<CheckCircle2 size={11} />}>
                {item.status === 'PENDING_VERIFICATION' ? t('pending_admin') : t('verified')}
              </Badge>
            </span>
          </div>

          <h3 className="kg-display mb-1 text-[26px] leading-tight text-gray-900">{item.craftType}</h3>
          <p className="mb-6 text-sm text-gray-500">
            {patchId ? <span className="kg-label">{patchId}</span> : t('pending_admin')}
          </p>

          {/* Fair Value Ledger */}
          <Card tone="muted" className="mb-5">
            <SectionLabel className="mb-4">Fair value ledger</SectionLabel>

            <SectionEyebrow>{t('fair_wage_floor')}</SectionEyebrow>
            <p className="kg-display mb-2 mt-1 text-[26px] leading-none text-gray-900">
              {formatRupees(item.fairWageFloor)}
            </p>
            <ProgressBar
              value={item.fairWageFloor || 0}
              max={bandMax || item.fairWageFloor || 1}
              tone="success"
              label={t('fair_wage_floor')}
              className="mb-5"
            />

            {bandMax > 0 && (
              <>
                <SectionEyebrow className="mb-2">{t('market_price_band')}</SectionEyebrow>
                <BandMarker
                  min={bandMin}
                  max={bandMax}
                  value={listingPrice ?? (bandMin + bandMax) / 2}
                  minLabel={formatRupees(bandMin)}
                  maxLabel={formatRupees(bandMax)}
                  caption={`${t('your_listing_price')}: ${formatRupees(listingPrice)}`}
                />
              </>
            )}

            <div className="mt-5 flex items-center justify-between gap-3 border-t border-gray-200/70 pt-4">
              <SectionEyebrow>Authenticity</SectionEyebrow>
              <span className="text-sm font-semibold text-gray-900">
                {Math.round(Number(item.fairnessScore) || 0)}%
              </span>
            </div>
          </Card>

          {/* Money actually received */}
          <Card className={cn('mb-5', money.received && 'border-green-200 bg-green-50')}>
            <SectionEyebrow tone={money.received ? "muted" : "muted"}>{money.label}</SectionEyebrow>
            <p
              className={cn(
                'kg-display mt-1 text-[26px] leading-none',
                money.received ? 'text-green-800' : 'text-gray-500'
              )}
            >
              {money.value}
            </p>
            {money.helper && (
              <p className="mt-2 text-xs leading-relaxed text-gray-500">{money.helper}</p>
            )}
          </Card>

          {/* Maker's journey */}
          {item.descriptionEnglish && (
            <div className="mb-5">
              <SectionLabel>Maker&rsquo;s journey</SectionLabel>
              <p className="whitespace-pre-line text-sm leading-relaxed text-gray-600">
                {item.descriptionEnglish}
              </p>
            </div>
          )}

          {/* The physical-patch proof. This is the photo the artisan took of the
              finished piece with its printed QR stuck on, which the AI matched
              against the original capture before the item became sellable —
              deliberately a different picture from the hero image above. */}
          {patchPhoto && (
            <div className="mb-5">
              <SectionLabel
                action={
                  <Badge variant="success" icon={<CheckCircle2 size={11} />}>
                    {t('verified_authentic')}
                  </Badge>
                }
              >
                {t('verification_photo_title')}
              </SectionLabel>

              <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-gray-200 bg-gray-100">
                <Image
                  src={patchPhoto}
                  alt={t('verification_photo_title')}
                  fill
                  sizes="(max-width: 640px) 100vw, 512px"
                  /* Real uploads arrive as data URLs, seeded ones as /seed paths.
                     Only the former cannot go through the optimizer. */
                  unoptimized={patchPhoto.startsWith('data:') || patchPhoto.startsWith('/api/')}
                  className="object-cover"
                />
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
                {t('verification_photo_note')}
              </p>
            </div>
          )}

          {/* Facts */}
          <dl className="mb-6 grid grid-cols-2 gap-3">
            <Fact label={t('labor_days')} value={`${item.laborDays ?? '—'} ${t('days')}`} />
            <Fact label={t('material_cost')} value={formatRupees(item.rawMaterialCost)} />
            <Fact label={t('your_listing_price')} value={formatRupees(listingPrice)} />
            <Fact label={t('status')} value={statusBadge(item.status).label} />
          </dl>

          {/* Product Timeline — the same audit chain the public passport shows */}
          <SectionLabel>{t('product_timeline')}</SectionLabel>
          <div className="space-y-3">
            {timeline && timeline.length > 0 ? (
              timeline.map((log: any) => (
                <div key={log.id} className="flex items-start gap-3">
                  <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-pill)] text-gray-700">
                    <CheckCircle2 size={13} />
                  </span>
                  <div className="min-w-0 flex-1 rounded-xl bg-[var(--color-gray-100)] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] font-semibold text-gray-900">
                        {log.action.replace(/_/g, ' ')}
                      </span>
                      {log.actorRole && (
                        <Badge variant="neutral" caps className="shrink-0">{log.actorRole}</Badge>
                      )}
                    </div>
                    <time className="mt-1 block text-[11px] font-medium text-gray-400">
                      {new Date(log.createdAt).toLocaleDateString('en-IN')} ·{' '}
                      {new Date(log.createdAt).toLocaleTimeString('en-IN')}
                    </time>
                    <p className="mt-1.5 text-xs leading-relaxed text-gray-600">
                      {log.comments || `State updated to ${log.newState?.status || 'Unknown'}`}
                    </p>
                  </div>
                </div>
              ))
            ) : (
              <p className="py-2 text-sm italic text-gray-500">{t('no_timeline_events')}</p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 gap-3 border-t border-gray-200/70 p-4">
          {patchId && (
            <Link
              href={`/verify/${patchId}`}
              className="kg-press flex min-h-[46px] flex-1 items-center justify-center rounded-xl border border-gray-300 text-sm font-semibold text-gray-800 hover:bg-gray-50"
            >
              {t('view_passport')}
            </Link>
          )}
          <button
            onClick={onClose}
            className="kg-press min-h-[46px] flex-1 rounded-xl bg-primary text-sm font-semibold text-white hover:bg-primary-dark"
          >
            {t('close_btn')}
          </button>
        </div>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl bg-[var(--color-gray-100)] px-3.5 py-3">
      <dt className="kg-label font-medium text-gray-500">{label}</dt>
      <dd className="mt-1 truncate text-sm font-semibold text-gray-900">{value}</dd>
    </div>
  );
}
