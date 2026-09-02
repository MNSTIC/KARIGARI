"use client";

import { X } from "lucide-react";
import { AssistantChat } from "@/components/ui/AssistantChat";
import { useLanguage } from "@/lib/translations";

/**
 * The assistant as a sheet, for pages that do not have room to dock it.
 *
 * The conversation itself lives in `AssistantChat` so the Learn page's docked
 * panel and this modal cannot drift apart. `craftType` comes from the caller's
 * profile data: it used to be hardcoded to 'Pattachitra' for every user, so a
 * Banarasi weaver was asking about — and being shown videos of — someone
 * else's craft.
 */
export function LearningAssistantModal({
  isOpen,
  onClose,
  craftType,
  seedQuestion,
}: {
  isOpen: boolean;
  onClose: () => void;
  craftType?: string | null;
  seedQuestion?: string | null;
}) {
  const { t } = useLanguage();

  if (!isOpen) return null;

  return (
    <div className="kg-fade fixed inset-0 z-[120] flex items-end justify-center bg-black/55 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="flex h-[86vh] w-full flex-col overflow-hidden rounded-t-3xl shadow-2xl sm:h-[620px] sm:max-w-md sm:rounded-3xl">
        <AssistantChat
          craftType={craftType}
          seedQuestion={seedQuestion}
          className="h-full"
          headerAction={
            <button
              onClick={onClose}
              aria-label={t("close_btn")}
              className="kg-press flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
            >
              <X size={18} />
            </button>
          }
        />
      </div>
    </div>
  );
}
