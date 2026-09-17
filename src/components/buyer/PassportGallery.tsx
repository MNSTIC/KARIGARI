"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, Expand, ImageOff, X } from "lucide-react";
import { useLanguage } from "@/lib/translations";
import { cn } from "@/lib/utils";
import type { PassportImage, PassportVariant } from "@/lib/passport";

/**
 * The piece's photos: a main frame, a thumbnail strip, and a full-size view.
 *
 * Real `images[]` first, then any stored look thumbnails. Only the frame on
 * screen is requested at full size — the rest load when chosen — and every
 * data-backed photo arrives through /api/passport/[id]/image, so a 2–3 MB
 * capture never freezes the page. Arrow keys and swipes move between frames;
 * Escape closes the full-size view and focus returns to the button that opened
 * it. No lightbox library.
 */

interface Frame {
  key: string;
  image: PassportImage;
  labelKey: string | null;
}

const SWIPE_THRESHOLD_PX = 40;

export function PassportGallery({
  images,
  variants,
  alt,
  priority = false,
}: {
  images: PassportImage[];
  variants: PassportVariant[];
  alt: string;
  priority?: boolean;
}) {
  const { t } = useLanguage();
  const frames: Frame[] = [
    ...images.map((image, index) => ({ key: `photo-${index}`, image, labelKey: null })),
    ...variants.map((variant) => ({ key: `look-${variant.key}`, image: variant.image, labelKey: variant.labelKey })),
  ];
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const touchStart = useRef<number | null>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const count = frames.length;
  const current = frames[Math.min(index, Math.max(0, count - 1))];

  const go = useCallback(
    (delta: number) => {
      if (count < 2) return;
      setIndex((value) => (value + delta + count) % count);
    },
    [count]
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      go(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      go(-1);
    }
  };

  const onTouchStart = (event: React.TouchEvent) => {
    touchStart.current = event.touches[0]?.clientX ?? null;
  };
  const onTouchEnd = (event: React.TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    const end = event.changedTouches[0]?.clientX;
    if (start === null || end === undefined) return;
    const delta = end - start;
    if (Math.abs(delta) >= SWIPE_THRESHOLD_PX) go(delta < 0 ? 1 : -1);
  };

  // Full-size view: Escape closes, arrows move, Tab stays on its three
  // controls, and focus goes back to the opener afterwards.
  useEffect(() => {
    if (!open) return;
    const kickoff = setTimeout(() => closeButton.current?.focus(), 0);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      } else if (event.key === "ArrowRight") {
        go(1);
      } else if (event.key === "ArrowLeft") {
        go(-1);
      } else if (event.key === "Tab") {
        const root = document.getElementById("passport-gallery-dialog");
        const focusable = root ? [...root.querySelectorAll<HTMLElement>("button:not([disabled])")] : [];
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    const opener = expandButton.current;
    return () => {
      clearTimeout(kickoff);
      window.removeEventListener("keydown", onKey);
      // Closing by button, Escape or unmount all hand focus back to the opener.
      setTimeout(() => opener?.focus(), 0);
    };
  }, [open, go]);

  const close = () => setOpen(false);

  if (!current) {
    return (
      <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-3xl bg-[var(--color-pill)] text-gray-500">
        <ImageOff size={36} aria-hidden />
        <span className="text-[13px]">{t("gallery_no_photo")}</span>
      </div>
    );
  }

  const position = t("gallery_position").replace("{n}", String(index + 1)).replace("{total}", String(count));

  return (
    <div>
      <div
        role="region"
        aria-roledescription="carousel"
        aria-label={t("gallery_label")}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        className="relative aspect-square w-full overflow-hidden rounded-3xl bg-[var(--color-pill)] outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Image
          key={current.key}
          src={current.image.src}
          unoptimized={current.image.unoptimized}
          alt={current.labelKey ? `${alt} · ${t(current.labelKey)}` : alt}
          fill
          sizes="(max-width: 1024px) 100vw, 50vw"
          priority={priority && index === 0}
          className="kg-fade object-cover"
        />
        {count > 1 && (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label={t("gallery_previous")}
              className="kg-press absolute left-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-gray-900 shadow-card"
            >
              <ChevronLeft size={20} />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label={t("gallery_next")}
              className="kg-press absolute right-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-gray-900 shadow-card"
            >
              <ChevronRight size={20} />
            </button>
            <span aria-live="polite" className="kg-label absolute bottom-3 left-3 rounded-full bg-white/90 px-2.5 py-1 font-medium text-gray-700">
              {position}
            </span>
          </>
        )}
        <button
          ref={expandButton}
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t("gallery_full_size")}
          className="kg-press absolute bottom-3 right-3 flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-gray-900 shadow-card"
        >
          <Expand size={18} />
        </button>
      </div>

      {count > 1 && (
        <ul className="kg-rail mt-3 flex gap-2.5 overflow-x-auto pb-1">
          {frames.map((frame, frameIndex) => (
            <li key={frame.key} className="shrink-0">
              <button
                type="button"
                onClick={() => setIndex(frameIndex)}
                aria-label={
                  frame.labelKey
                    ? `${t("gallery_look")} ${t(frame.labelKey)}`
                    : `${t("view_photo")} ${frameIndex + 1}`
                }
                aria-current={frameIndex === index ? "true" : undefined}
                className={cn(
                  "kg-press relative block h-16 w-16 overflow-hidden rounded-xl border-2 transition-colors",
                  frameIndex === index ? "border-gray-900" : "border-transparent hover:border-gray-300"
                )}
              >
                <Image src={frame.image.thumb} unoptimized={frame.image.unoptimized} alt="" fill sizes="64px" className="object-cover" />
              </button>
              {frame.labelKey && (
                <span className="mt-1 block w-16 truncate text-center text-[10px] text-gray-500">{t(frame.labelKey)}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div
          id="passport-gallery-dialog"
          role="dialog"
          aria-modal="true"
          aria-label={t("gallery_full_size")}
          className="fixed inset-0 z-[130] flex flex-col bg-primary/95"
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          <div className="flex items-center justify-between gap-3 px-4 py-3 text-white">
            <span className="kg-label font-medium text-white/80">{position}</span>
            <button
              ref={closeButton}
              type="button"
              onClick={close}
              aria-label={t("close_btn")}
              className="kg-press flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
            >
              <X size={20} />
            </button>
          </div>
          <div className="relative min-h-0 flex-1">
            <Image
              key={`full-${current.key}`}
              src={current.image.src}
              unoptimized={current.image.unoptimized}
              alt={alt}
              fill
              sizes="100vw"
              className="object-contain"
            />
          </div>
          <div className="flex items-center justify-center gap-4 px-4 py-4">
            <button
              type="button"
              onClick={() => go(-1)}
              disabled={count < 2}
              aria-label={t("gallery_previous")}
              className="kg-press flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 disabled:opacity-30"
            >
              <ChevronLeft size={22} />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              disabled={count < 2}
              aria-label={t("gallery_next")}
              className="kg-press flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 disabled:opacity-30"
            >
              <ChevronRight size={22} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
