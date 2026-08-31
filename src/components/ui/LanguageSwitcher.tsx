"use client";

import { useState } from "react";
import { ChevronDown, Globe } from "lucide-react";
import { useLanguage, type Language } from "@/lib/translations";
import { cn } from "@/lib/utils";

/**
 * The four-language menu, extracted from the artisan dashboard header.
 *
 * A visitor has to be able to switch before they log in, so this now sits on
 * the landing page and the public marketplace as well. Going through
 * `changeLanguage` matters: it writes localStorage *and* dispatches the
 * `language-change` event every mounted `useLanguage()` listens for. Writing
 * localStorage directly — which the login page used to do — leaves every other
 * component on the page showing the old language until a reload.
 */

const OPTIONS: { code: Language; label: string }[] = [
  { code: "en", label: "English" },
  { code: "hi", label: "हिंदी" },
  { code: "or", label: "ଓଡ଼ିଆ" },
  { code: "te", label: "తెలుగు" },
];

export function LanguageSwitcher({ className }: { className?: string }) {
  const { language, changeLanguage } = useLanguage();
  const [open, setOpen] = useState(false);

  return (
    <div
      className={cn("relative", className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1.5 py-2 text-sm font-bold text-gray-600 hover:text-primary transition-colors"
      >
        <Globe size={16} />
        <span className="uppercase">{language}</span>
        <ChevronDown size={14} />
      </button>

      {open && (
        <div className="absolute right-0 top-full w-32 pt-1 z-50">
          <div className="bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden">
            {OPTIONS.map((option) => (
              <button
                key={option.code}
                type="button"
                onClick={() => {
                  changeLanguage(option.code);
                  setOpen(false);
                }}
                className={cn(
                  "block w-full text-left px-4 py-2 text-sm font-medium hover:bg-gray-50 transition-colors",
                  language === option.code ? "text-primary" : "text-gray-700"
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
