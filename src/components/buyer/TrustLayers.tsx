"use client";

import { ClipboardCheck, ScanSearch, UserRound } from "lucide-react";
import { useLanguage } from "@/lib/translations";
import { SectionHeading } from "@/components/ui/SectionEyebrow";
import type { TrustLayers as TrustLayersData } from "@/lib/passportFacts";
import { fill, languageName, passportDay } from "@/components/buyer/passportFormat";

/**
 * Why a buyer can trust this record, as three layers — and only what each one
 * actually did. The AI layer is an image-similarity comparison against the
 * original capture photo (`provenanceReference()`), shown with its stored
 * score; it is never described as authenticating the craft, and no model
 * accuracy figure appears anywhere.
 */
export function TrustLayers({ trust, stacked = false }: { trust: TrustLayersData; /** One column, for a narrow side column. */ stacked?: boolean }) {
  const { t } = useLanguage();

  const language = trust.human.language ? languageName(trust.human.language, t) : null;
  const method =
    trust.human.method === "VOICE"
      ? language
        ? fill(t("story_catalogued_by_voice"), { language })
        : t("story_catalogued_by_voice_plain")
      : trust.human.method === "IVR"
        ? language
          ? fill(t("story_catalogued_by_phone"), { language })
          : t("story_catalogued_by_phone_plain")
        : null;

  const similarity = trust.ai.similarity;

  const layers = [
    {
      key: "human",
      icon: <UserRound size={16} />,
      title: t("trust_layer_human"),
      lines: [
        t("trust_layer_human_body"),
        trust.human.at ? fill(t("trust_layer_human_at"), { date: passportDay(trust.human.at) }) : null,
        method,
      ],
    },
    {
      key: "admin",
      icon: <ClipboardCheck size={16} />,
      title: t("trust_layer_admin"),
      lines: [
        trust.admin.at
          ? fill(t("trust_layer_admin_at"), { date: passportDay(trust.admin.at) })
          : t("trust_layer_admin_pending"),
      ],
    },
    {
      key: "ai",
      icon: <ScanSearch size={16} />,
      title: t("trust_layer_ai"),
      lines: [
        t("trust_layer_ai_body"),
        trust.ai.patchMatchedAt
          ? fill(t("trust_layer_ai_patch"), { date: passportDay(trust.ai.patchMatchedAt) })
          : trust.ai.waivedAt
            ? fill(t("trust_layer_ai_waived"), { date: passportDay(trust.ai.waivedAt) })
            : t("trust_layer_ai_none"),
      ],
    },
  ];

  return (
    <section aria-labelledby="passport-trust">
      <SectionHeading id="passport-trust" size="sm">
        {t("trust_layers_title")}
      </SectionHeading>
      <ol className={stacked ? "kg-stagger mt-2 grid gap-3" : "kg-stagger mt-2 grid gap-3 md:grid-cols-3"}>
        {layers.map((layer, index) => (
          <li key={layer.key} className="rounded-2xl border border-gray-200/70 bg-card p-4 shadow-card">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-pill)] text-gray-800">
                {layer.icon}
              </span>
              <span className="kg-label font-medium text-gray-500">{index + 1}</span>
              <h3 className="min-w-0 text-[14px] font-semibold text-gray-900">{layer.title}</h3>
            </div>
            <div className="mt-3 space-y-1.5">
              {layer.lines.filter(Boolean).map((line) => (
                <p key={line} className="text-[13px] leading-relaxed text-gray-600">
                  {line}
                </p>
              ))}
              {layer.key === "ai" && similarity && (
                <p className="mt-2 flex flex-wrap items-baseline gap-x-2 rounded-xl bg-[var(--color-gray-100)] px-3 py-2 text-[13px] text-gray-800">
                  <span className="kg-label font-medium text-gray-500">{t("trust_similarity_label")}</span>
                  <span className="kg-display text-[20px] leading-none text-gray-900">{similarity.score}/100</span>
                  <span className="text-[12px] text-gray-600">
                    {fill(t(similarity.source === "DELIVERY_SCAN" ? "trust_similarity_delivery" : "trust_similarity_ready"), {
                      date: similarity.at ? passportDay(similarity.at) : "—",
                    })}
                  </span>
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-[12px] leading-relaxed text-gray-500">{t("trust_layers_note")}</p>
    </section>
  );
}
