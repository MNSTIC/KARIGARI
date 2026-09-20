"use client";

import { useState } from "react";
import { Boxes, Recycle, Wrench } from "lucide-react";
import { Shell } from "@/components/ui/AppShell";
import { PageLede, PageTitle } from "@/components/ui/SectionEyebrow";
import { SegmentedToggle } from "@/components/ui/SegmentedToggle";
import { useLanguage } from "@/lib/translations";
import { useUrlTab } from "@/lib/urlTab";
import { fill } from "@/components/buyer/passportFormat";
import { MaterialsSection } from "@/components/workshop/MaterialsSection";
import { RepairSection } from "@/components/workshop/RepairSection";
import { ScrapSection } from "@/components/workshop/ScrapSection";

/**
 * Workshop Resources — everything the supply side of a workshop needs.
 *
 * This is the old Raw Materials page (still reachable at /artisan/materials,
 * which now redirects here) widened to the two things that stop an artisan just
 * as often as thread does: a broken tool and no money to replace it.
 *
 *  · Materials — unchanged, curated + AI, with its sample caveat intact.
 *  · Repair & tooling — the artisan's own cluster, plus a brief that names no
 *    business, because no verified directory of repairers exists to name one from.
 *  · Equipment funding — the schemes that actually buy equipment, each card
 *    citing the official page its figures came from and the date it was checked.
 *  · Scrap & waste — offcuts and shavings pooled across the cluster until the
 *    weight is worth a recycler's trip. Held back from Phase 8 on purpose, so
 *    that an empty tab never shipped ahead of the feature behind it.
 *
 * The tab lives in the URL (`?tab=repair`), so the sidebar, the restock nudge
 * and a bookmark can all deep-link to one section.
 */

const TABS = ["materials", "repair", "scrap"] as const;
type Tab = (typeof TABS)[number];

export default function WorkshopPage() {
  const { t } = useLanguage();
  const [tab, setTab] = useUrlTab<Tab>("materials", TABS);
  const [craftName, setCraftName] = useState("");

  return (
    <Shell>
      <div className="mb-9">
        <PageTitle>{t("workshop_title")}</PageTitle>
        <PageLede>
          {craftName ? fill(t("workshop_lede"), { craft: craftName }) : t("workshop_lede_generic")}
        </PageLede>
      </div>

      <SegmentedToggle
        ariaLabel={t("workshop_title")}
        value={tab}
        onChange={setTab}
        className="mb-7"
        options={[
          { value: "materials", label: t("workshop_tab_materials"), icon: <Boxes size={14} /> },
          { value: "repair", label: t("workshop_tab_repair"), icon: <Wrench size={14} /> },
          { value: "scrap", label: t("workshop_tab_scrap"), icon: <Recycle size={14} /> },
        ]}
      />

      {/* Each section owns its own fetch, so switching tabs never refetches the
          one the artisan came from — and the materials tab, which is the one
          they open most, is not made to wait for the other two. */}
      {tab === "materials" && <MaterialsSection onCraftName={setCraftName} />}
      {tab === "repair" && <RepairSection />}
      {tab === "scrap" && <ScrapSection />}
    </Shell>
  );
}
