"use client";

import Image from "next/image";
import { ArrowRight, Clock, Newspaper } from "lucide-react";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { cn } from "@/lib/utils";

/**
 * News cards.
 *
 * Two shapes from the same data: `FeaturedArticle` is the big image card at the
 * top of the feed, `ArticleRow` is a list entry. Both are honest about a
 * missing image — the news pipeline returns headlines with no artwork, and a
 * grey box with a newspaper glyph is better than an empty frame pretending a
 * photograph failed to load.
 */

export interface Article {
  title?: string;
  description?: string;
  date?: string;
  source?: string;
  link?: string;
  /** Category label, already resolved to something human. */
  category?: string;
  image?: string | null;
  readMinutes?: number | null;
}

function Thumb({
  src,
  alt,
  className,
  sizes,
}: {
  src?: string | null;
  alt: string;
  className?: string;
  sizes: string;
}) {
  if (!src) {
    return (
      <span
        className={cn(
          "flex items-center justify-center bg-[var(--color-pill)] text-gray-400",
          className
        )}
      >
        <Newspaper size={26} strokeWidth={1.4} />
      </span>
    );
  }
  return (
    <span className={cn("relative block overflow-hidden bg-[var(--color-pill)]", className)}>
      <Image
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        unoptimized={src.startsWith("data:") || src.startsWith("/api/")}
        className="object-cover"
      />
    </span>
  );
}

/** The lead story: image left, editorial column right. */
export function FeaturedArticle({ article }: { article: Article }) {
  const Wrapper = article.link ? "a" : "div";

  return (
    <Wrapper
      {...(article.link
        ? { href: article.link, target: "_blank", rel: "noopener noreferrer" }
        : {})}
      className="kg-lift group grid overflow-hidden rounded-3xl border border-gray-200/70 bg-card shadow-card sm:grid-cols-[minmax(0,42%)_minmax(0,1fr)]"
    >
      <div className="relative">
        <Thumb
          src={article.image}
          alt={article.title || "Article"}
          className="h-52 w-full sm:h-full sm:min-h-[300px]"
          sizes="(max-width: 640px) 100vw, 42vw"
        />
        {article.category && (
          <span className="kg-label absolute left-4 top-4 rounded-full bg-[var(--color-maroon)] px-3 py-1.5 font-medium text-white">
            {article.category}
          </span>
        )}
      </div>

      <div className="flex flex-col p-6 sm:p-8">
        <div className="kg-label flex flex-wrap items-center gap-x-3 gap-y-1 text-gray-500">
          {article.date && <span>{article.date}</span>}
          {article.readMinutes ? (
            <span className="inline-flex items-center gap-1.5">
              <Clock size={11} /> {article.readMinutes} min read
            </span>
          ) : null}
        </div>

        <h3 className="kg-display mt-3 text-[26px] leading-[1.15] text-gray-900 sm:text-[32px]">
          {article.title}
        </h3>

        {article.description && (
          <p className="mt-3 line-clamp-4 text-[15px] leading-relaxed text-gray-600">
            {article.description}
          </p>
        )}

        <span className="mt-6 inline-flex items-center gap-2 text-[13px] font-semibold text-gray-900">
          {article.link ? "Read full report" : article.source || "Karigari desk"}
          {article.link && (
            <ArrowRight size={15} className="transition-transform group-hover:translate-x-1" />
          )}
        </span>
      </div>
    </Wrapper>
  );
}

/** A row in "Recent Articles": square thumb, category, title, excerpt. */
export function ArticleRow({ article }: { article: Article }) {
  const Wrapper = article.link ? "a" : "div";

  return (
    <Wrapper
      {...(article.link
        ? { href: article.link, target: "_blank", rel: "noopener noreferrer" }
        : {})}
      className="kg-lift kg-list-item flex gap-4 rounded-2xl border border-gray-200/70 bg-card p-4 shadow-card sm:gap-5 sm:p-5"
    >
      <Thumb
        src={article.image}
        alt={article.title || "Article"}
        className="h-[88px] w-[88px] shrink-0 rounded-xl sm:h-28 sm:w-32"
        sizes="128px"
      />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          {article.category && <SectionEyebrow tone="maroon">{article.category}</SectionEyebrow>}
          {article.date && (
            <>
              <span aria-hidden className="text-[10px] text-gray-300">
                •
              </span>
              <span className="kg-label text-gray-400">{article.date}</span>
            </>
          )}
        </div>

        <h3 className="kg-display mt-1.5 line-clamp-2 text-[19px] leading-snug text-gray-900">
          {article.title}
        </h3>

        {article.description && (
          <p className="mt-1.5 line-clamp-2 text-[14px] leading-relaxed text-gray-600">
            {article.description}
          </p>
        )}
      </div>
    </Wrapper>
  );
}
