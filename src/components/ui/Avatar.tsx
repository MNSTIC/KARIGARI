"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * Profile picture with a real fallback.
 *
 * Every avatar in the app used to fall back to `/female_artisan.jpg` — one
 * stock photograph of a woman, shown for every artisan, every buyer and the
 * user's own chat bubble. That is wrong twice over: it puts a stranger's face
 * on people it does not belong to, and it makes six different artisans look
 * like the same person.
 *
 * With no photo we draw the WhatsApp-style thing instead: the person's initials
 * on a colour derived from their own name, so it is stable for them and
 * distinct from the next person.
 */

/**
 * Palette pulled from the heritage theme rather than random hues, so a wall of
 * generated avatars still reads as one product.
 */
const COLOURS = [
  "#1A1A1A", // ink
  "#4A423C", // ink light
  "#5A1A1A", // maroon
  "#C2632F", // terracotta
  "#4D5D6C", // slate
  "#9A7B3F", // ochre
  "#4A5241", // olive
  "#6B5A78", // plum
];

/**
 * Deterministic name -> colour. djb2, because the same person must keep the
 * same colour across sessions and devices without storing anything.
 */
function colourFor(name: string): string {
  let hash = 5381;
  for (let i = 0; i < name.length; i += 1) {
    hash = ((hash << 5) + hash + name.charCodeAt(i)) | 0;
  }
  return COLOURS[Math.abs(hash) % COLOURS.length];
}

/**
 * "Lakshmi Devi Meher" -> "LM". Falls back to the first character, then to a
 * neutral dot, so this never renders empty.
 */
function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "·";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export interface AvatarProps {
  /** Used for the initials and the colour. */
  name?: string | null;
  /** A stored photo: a `/seed/...` path, an uploaded data URL, or nothing. */
  src?: string | null;
  /** Rendered size in px. */
  size?: number;
  className?: string;
}

export function Avatar({ name, src, size = 40, className }: AvatarProps) {
  const label = (name || "").trim();
  const photo = (src || "").trim();

  if (photo) {
    return (
      <div
        className={cn("relative rounded-full overflow-hidden shrink-0 bg-gray-100", className)}
        style={{ width: size, height: size }}
      >
        <Image
          src={photo}
          alt={label || "Profile photo"}
          fill
          sizes={`${size}px`}
          /* Uploaded avatars are base64 data URLs, which the image optimizer
             cannot fetch. Seeded `/seed/...` paths go through it normally. */
          unoptimized={photo.startsWith("data:") || photo.startsWith("/api/")}
          className="object-cover"
        />
      </div>
    );
  }

  return (
    <div
      aria-label={label || undefined}
      role={label ? "img" : undefined}
      className={cn(
        "rounded-full shrink-0 flex items-center justify-center text-white font-bold select-none",
        className
      )}
      style={{
        width: size,
        height: size,
        backgroundColor: colourFor(label || "karigari"),
        // Scales with the circle so the initials sit right at any size.
        fontSize: Math.max(10, Math.round(size * 0.4)),
        lineHeight: 1,
      }}
    >
      {initialsFor(label)}
    </div>
  );
}
