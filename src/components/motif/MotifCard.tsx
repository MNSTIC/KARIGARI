"use client";

import Image from "next/image";
import { AlertTriangle, CheckCircle2, Clock, Fingerprint, XCircle } from "lucide-react";
import { useLanguage } from "@/lib/translations";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { fill } from "@/components/buyer/passportFormat";
import { formatHash, type MotifStatus } from "@/lib/motifHash";
import type { MotifDescriptors } from "@/lib/motifLicence";

/**
 * One motif record, as both the cluster and the public see it.
 *
 * The fingerprint is shown as sixteen hex characters in the mono face because
 * that is what it is — a number a reviewer can compare, not a seal. The status
 * words are plain and the flagged one is deliberately neutral: a near match
 * means two records look alike and a person will look at them, not that anybody
 * copied anything.
 */

export interface MotifCardData {
  id: string;
  name: string;
  hash: string;
  clusterName: string;
  submittedBy: string;
  descriptors: MotifDescriptors;
  referenceImageUrl: string | null;
  status: MotifStatus;
  licensable: boolean;
  registeredAt: string;
  duplicateDistance?: number | null;
  adminNote?: string | null;
  mine?: boolean;
}

const STATUS_KEY: Record<MotifStatus, string> = {
  PENDING: "motif_status_pending",
  REGISTERED: "motif_status_registered",
  FLAGGED_DUPLICATE: "motif_status_flagged",
  REJECTED: "motif_status_rejected",
};

const STATUS_VARIANT: Record<MotifStatus, "neutral" | "success" | "warning" | "danger"> = {
  PENDING: "neutral",
  REGISTERED: "success",
  FLAGGED_DUPLICATE: "warning",
  REJECTED: "danger",
};

const STATUS_ICON: Record<MotifStatus, React.ReactNode> = {
  PENDING: <Clock size={12} aria-hidden />,
  REGISTERED: <CheckCircle2 size={12} aria-hidden />,
  FLAGGED_DUPLICATE: <AlertTriangle size={12} aria-hidden />,
  REJECTED: <XCircle size={12} aria-hidden />,
};

const IST_DAY: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Kolkata",
};

export function MotifCard({
  motif,
  footer,
  className,
}: {
  motif: MotifCardData;
  footer?: React.ReactNode;
  className?: string;
}) {
  const { t } = useLanguage();
  const d = motif.descriptors;

  return (
    <Card pad="md" className={cn("min-w-0", className)}>
      <div className="flex gap-3">
        {motif.referenceImageUrl ? (
          // A data URL the artisan's own browser produced; `unoptimized` because
          // there is nothing for the image pipeline to fetch, and `fill` inside a
          // sized box because CSS-resizing a width/height image makes Next warn.
          <span className="relative block h-[72px] w-[72px] shrink-0 overflow-hidden rounded-xl border border-gray-200">
            <Image src={motif.referenceImageUrl} alt={motif.name} fill sizes="72px" unoptimized className="object-cover" />
          </span>
        ) : (
          <span className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-xl border border-dashed border-gray-300 text-gray-400">
            <Fingerprint size={20} aria-hidden />
          </span>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 truncate text-[15px] font-semibold text-gray-900">{motif.name}</h3>
            <Badge variant={STATUS_VARIANT[motif.status]} icon={STATUS_ICON[motif.status]}>
              {t(STATUS_KEY[motif.status])}
            </Badge>
          </div>
          <p className="mt-0.5 text-[12px] text-gray-500">
            {fill(t("motif_held_by"), { cluster: motif.clusterName })}
          </p>
          <p className="mt-1.5 font-mono text-[12px] tracking-wide text-gray-700" title={t("motif_fingerprint")}>
            {formatHash(motif.hash)}
          </p>
          <p className="mt-0.5 text-[11px] text-gray-500">
            {fill(t("motif_registered_on"), {
              date: new Date(motif.registeredAt).toLocaleString("en-IN", IST_DAY),
            })}
            {motif.submittedBy ? ` · ${fill(t("motif_filed_by"), { name: motif.submittedBy })}` : ""}
          </p>
        </div>
      </div>

      {motif.status === "FLAGGED_DUPLICATE" && (
        <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-900">
          {typeof motif.duplicateDistance === "number"
            ? fill(t("motif_flagged_explain"), { distance: motif.duplicateDistance })
            : t("motif_flagged_explain_plain")}
        </p>
      )}

      {motif.adminNote && (
        <p className="mt-2 text-[12px] leading-relaxed text-gray-600">
          <span className="font-semibold">{t("motif_admin_note")}:</span> {motif.adminNote}
        </p>
      )}

      {(d.motifs.length > 0 || d.symmetry || d.repeatUnit || d.palette.length > 0) && (
        <div className="mt-3 border-t border-gray-100 pt-3">
          <div className="flex items-center gap-2">
            <SectionEyebrow>{t("motif_descriptors")}</SectionEyebrow>
            <Badge variant={d.source === "AI" ? "info" : "neutral"}>
              {t(d.source === "AI" ? "motif_source_ai" : "motif_source_heuristic")}
            </Badge>
          </div>
          {d.motifs.length > 0 && (
            <p className="mt-1.5 text-[13px] text-gray-700">{d.motifs.join(" · ")}</p>
          )}
          {d.symmetry && (
            <p className="mt-1 text-[12px] leading-relaxed text-gray-600">
              <span className="font-semibold">{t("motif_symmetry")}:</span> {d.symmetry}
            </p>
          )}
          {d.repeatUnit && (
            <p className="mt-1 text-[12px] leading-relaxed text-gray-600">
              <span className="font-semibold">{t("motif_repeat_unit")}:</span> {d.repeatUnit}
            </p>
          )}
          {d.palette.length > 0 && (
            <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-gray-600">
              <span className="font-semibold">{t("motif_palette")}:</span>
              <span className="flex overflow-hidden rounded-full">
                {d.palette.map((colour) => (
                  <span key={colour} className="h-3.5 w-3.5" style={{ backgroundColor: colour }} />
                ))}
              </span>
            </p>
          )}
          {d.confidence !== null && (
            <p className="mt-1 text-[11px] text-gray-500">
              {fill(t("motif_confidence"), { percent: Math.round(d.confidence * 100) })}
            </p>
          )}
        </div>
      )}

      {footer && <div className="mt-3 border-t border-gray-100 pt-3">{footer}</div>}
    </Card>
  );
}
