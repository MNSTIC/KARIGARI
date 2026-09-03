"use client";

import { useCallback, useEffect, useState } from "react";
import { HandHeart, Loader2, MapPin, Package, PlusCircle, Users } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Card } from "@/components/ui/Card";
import { Shell } from "@/components/ui/AppShell";
import { SectionEyebrow, SectionHeading } from "@/components/ui/SectionEyebrow";
import { useLanguage } from "@/lib/translations";
import { cn } from "@/lib/utils";

/**
 * My Cluster — other artisans I collaborate with, and material asks between us.
 *
 * The page is deliberately read-heavy: cluster is a place to see who else is
 * near you and what they need before it is a place to fill in a form. The
 * "I Need a Resource" panel opens inline rather than in a modal, so the list
 * of open asks stays visible while a new one is drafted.
 *
 * Nothing here reasons about the cluster locally — it renders exactly what
 * /api/artisan/cluster-members returns, so the "who is a member" rule lives
 * on the server where the same rule can gate resource-request POSTs.
 */

interface Member {
  userId: string;
  name: string;
  craftType: string;
  location: string | null;
  clusterName: string | null;
  experienceYears: number;
  photoUrl: string | null;
}

interface ResourceRequest {
  id: string;
  resourceName: string;
  description: string | null;
  quantity: string | null;
  status: "OPEN" | "ACCEPTED" | "FULFILLED" | "CANCELLED";
  createdAt: string;
  requester: { id: string; name: string };
  acceptedBy: { id: string; name: string } | null;
  isMine: boolean;
}

interface ClusterPayload {
  success: true;
  cluster: {
    kind: "shg" | "auto";
    key: string;
    shgGroupLink: string | null;
    location: string | null;
  } | null;
  members: Member[];
  requests: ResourceRequest[];
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kolkata",
  });
}

export default function ClusterPage() {
  const { t } = useLanguage();
  const [payload, setPayload] = useState<ClusterPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [composing, setComposing] = useState(false);
  const [resourceName, setResourceName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/artisan/cluster-members", { cache: "no-store" });
      const data = await res.json();
      if (data?.success) {
        setPayload(data as ClusterPayload);
      } else {
        setError(data?.error || t("orders_load_failed"));
      }
    } catch (e) {
      console.error("Cluster load failed:", e);
      setError(t("orders_load_failed"));
    }
  }, [t]);

  useEffect(() => {
    const kickoff = setTimeout(load, 0);
    return () => clearTimeout(kickoff);
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const postRequest = async () => {
    if (!resourceName.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/artisan/resource-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resourceName, quantity, description }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        setError(data?.error || t("orders_load_failed"));
        return;
      }
      setResourceName("");
      setQuantity("");
      setDescription("");
      setComposing(false);
      setToast(t("cluster_post_request"));
      await load();
    } finally {
      setSubmitting(false);
    }
  };

  const accept = async (requestId: string) => {
    try {
      const res = await fetch("/api/artisan/resource-request", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        setError(data?.error || t("orders_load_failed"));
        return;
      }
      setToast(t("cluster_request_accepted"));
      await load();
    } catch (e) {
      console.error("Accept failed:", e);
    }
  };

  const fulfil = async (requestId: string) => {
    try {
      const res = await fetch("/api/artisan/resource-request", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        setError(data?.error || t("orders_load_failed"));
        return;
      }
      await load();
    } catch (e) {
      console.error("Fulfil failed:", e);
    }
  };

  if (payload === null && !error) {
    return (
      <Shell>
        <div className="flex items-center justify-center rounded-2xl border border-gray-200 bg-white p-10 text-gray-400">
          <Loader2 size={22} className="animate-spin" />
        </div>
      </Shell>
    );
  }

  const cluster = payload?.cluster ?? null;
  const members = payload?.members ?? [];
  const requests = payload?.requests ?? [];
  const heading = cluster?.kind === "shg" ? t("cluster_shg_group") : t("cluster_auto_group");

  return (
    <Shell>
      <header className="mb-8">
        <h1 className="kg-display text-[32px] leading-tight text-gray-900 sm:text-[40px]">
          {t("cluster_title")}
        </h1>
        {cluster && (
          <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
            <span className="inline-flex items-center gap-1.5">
              <Users size={14} /> {heading}
            </span>
            {cluster.location && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin size={14} /> {cluster.location}
              </span>
            )}
          </p>
        )}
      </header>

      {toast && (
        <div className="mb-6 rounded-xl border border-[var(--color-sage)] bg-[var(--color-mint)] px-4 py-3 text-sm font-medium text-primary">
          {toast}
        </div>
      )}
      {error && (
        <div className="mb-6 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
          {error}
        </div>
      )}

      {/* ------------------------------------------------------ Members */}
      <section className="mb-10">
        <SectionEyebrow>{heading}</SectionEyebrow>
        <SectionHeading className="mt-1">
          {members.length} {members.length === 1 ? "member" : "members"}
        </SectionHeading>

        {members.length === 0 ? (
          <p className="mt-4 rounded-2xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
            {t("cluster_no_members")}
          </p>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {members.map((member) => (
              <Card key={member.userId} className="p-5">
                <div className="flex items-start gap-3">
                  <Avatar name={member.name} src={member.photoUrl} size={48} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-gray-900">{member.name}</p>
                    <p className="truncate text-xs text-gray-500">{member.craftType}</p>
                    {member.location && (
                      <p className="mt-1 flex items-center gap-1 text-[11px] text-gray-400">
                        <MapPin size={11} /> {member.location}
                      </p>
                    )}
                    <p className="mt-1 text-[11px] font-medium text-primary/70">
                      {member.experienceYears} yr{member.experienceYears !== 1 ? "s" : ""}
                    </p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* ---------------------------------------------- Resource sharing */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <SectionEyebrow>{t("cluster_resource_sharing")}</SectionEyebrow>
            <SectionHeading className="mt-1">
              {requests.length}{" "}
              {requests.length === 1 ? "open request" : "open requests"}
            </SectionHeading>
          </div>
          <button
            type="button"
            onClick={() => setComposing((v) => !v)}
            className="kg-press inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-primary px-5 text-[13px] font-semibold text-white hover:bg-primary-dark"
          >
            <PlusCircle size={14} /> {t("cluster_need_resource")}
          </button>
        </div>

        {composing && (
          <Card className="mt-4 p-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="kg-label font-medium text-gray-500" htmlFor="res-name">
                  {t("cluster_resource_name")}
                </label>
                <input
                  id="res-name"
                  value={resourceName}
                  onChange={(e) => setResourceName(e.target.value)}
                  placeholder="e.g. Muga silk yarn (500g)"
                  className="mt-1.5 min-h-[44px] w-full rounded-xl border border-gray-200 px-3 text-[14px] outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="kg-label font-medium text-gray-500" htmlFor="res-qty">
                  {t("cluster_resource_qty")}
                </label>
                <input
                  id="res-qty"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="e.g. 500g"
                  className="mt-1.5 min-h-[44px] w-full rounded-xl border border-gray-200 px-3 text-[14px] outline-none focus:border-primary"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="kg-label font-medium text-gray-500" htmlFor="res-desc">
                  {t("cluster_resource_desc")}
                </label>
                <textarea
                  id="res-desc"
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="mt-1.5 w-full resize-y rounded-xl border border-gray-200 p-3 text-[14px] outline-none focus:border-primary"
                />
              </div>
            </div>
            <button
              type="button"
              onClick={postRequest}
              disabled={submitting || !resourceName.trim()}
              className={cn(
                "kg-press mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-primary px-5 text-[13px] font-semibold text-white hover:bg-primary-dark",
                (submitting || !resourceName.trim()) && "cursor-not-allowed opacity-50"
              )}
            >
              {submitting && <Loader2 size={14} className="animate-spin" />}
              {t("cluster_post_request")}
            </button>
          </Card>
        )}

        {requests.length === 0 ? (
          <p className="mt-4 rounded-2xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
            {t("cluster_no_requests")}
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {requests.map((request) => (
              <Card key={request.id} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-primary">
                      <Package size={12} /> {shortDate(request.createdAt)}
                      {request.status === "ACCEPTED" && (
                        <span className="rounded-full bg-[var(--color-mint)] px-2 py-0.5 text-primary">
                          {t("cluster_request_accepted")}
                        </span>
                      )}
                    </p>
                    <h3 className="mt-1 text-base font-bold text-gray-900">
                      {request.resourceName}
                    </h3>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {request.isMine ? "You" : request.requester.name}
                      {request.quantity ? ` · ${request.quantity}` : ""}
                    </p>
                    {request.description && (
                      <p className="mt-2 text-[13px] leading-relaxed text-gray-600">
                        {request.description}
                      </p>
                    )}
                    {request.acceptedBy && (
                      <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-primary/80">
                        <HandHeart size={12} /> {request.acceptedBy.name}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0">
                    {!request.isMine && request.status === "OPEN" && (
                      <button
                        type="button"
                        onClick={() => accept(request.id)}
                        className="kg-press inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-4 text-xs font-bold text-primary hover:bg-[var(--color-mint)]"
                      >
                        <HandHeart size={12} /> {t("cluster_i_can_help")}
                      </button>
                    )}
                    {request.isMine && request.status !== "FULFILLED" && (
                      <button
                        type="button"
                        onClick={() => fulfil(request.id)}
                        className="kg-press inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-bold text-white hover:bg-primary-dark"
                      >
                        {t("cluster_mark_fulfilled")}
                      </button>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>
    </Shell>
  );
}
