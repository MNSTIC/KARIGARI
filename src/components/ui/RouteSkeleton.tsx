/**
 * Instant placeholder shown while a route hydrates and fetches.
 *
 * These pages are client components that load their own data, so before this
 * existed a navigation showed a blank background until the first fetch
 * resolved. Next renders `loading.tsx` immediately on navigation, which makes
 * the app feel responsive without changing a single query.
 *
 * It draws no rail or header of its own: `loading.tsx` renders *inside* the
 * artisan layout, so the shell's sidebar and top bar are already on screen. A
 * second header here would flash a duplicate bar on every navigation.
 *
 * Server component on purpose: no hooks, no client JS, nothing to hydrate.
 */
export function RouteSkeleton({
  cards = 4,
  /** "grid" for card pages, "list" for the stacked list pages. */
  layout = "grid",
  /** Draws the big serif title block the redesigned pages open with. */
  title = true,
  /** Draws the right-hand column the news / schemes pages use. */
  aside = false,
}: {
  cards?: number;
  layout?: "grid" | "list";
  title?: boolean;
  aside?: boolean;
}) {
  const body = (
    <>
      {title && (
        <div className="mb-9">
          <div className="kg-shimmer mb-4 h-11 w-[min(420px,80%)] rounded-lg" />
          <div className="kg-shimmer h-3.5 w-[min(560px,95%)] rounded" />
        </div>
      )}

      {/* Hero block, matching the card every restyled page opens with. */}
      <div className="kg-shimmer mb-9 h-[168px] rounded-3xl" />

      <div className="kg-shimmer mb-5 h-7 w-52 rounded" />

      <div
        className={
          layout === "grid"
            ? "grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3"
            : "space-y-4"
        }
      >
        {Array.from({ length: cards }).map((_, i) => (
          <div
            key={i}
            className="rounded-2xl border border-gray-200/70 bg-card p-5 shadow-card"
          >
            {layout === "grid" && <div className="kg-shimmer mb-4 h-32 rounded-xl" />}
            <div className="kg-shimmer mb-2.5 h-4 w-3/4 rounded" />
            <div className="kg-shimmer h-3 w-1/2 rounded" />
          </div>
        ))}
      </div>
    </>
  );

  return (
    <div className="mx-auto max-w-[1180px] px-4 py-8 sm:px-6 sm:py-10 lg:px-10" aria-busy="true">
      {aside ? (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div>{body}</div>
          <div className="hidden space-y-5 lg:block">
            <div className="kg-shimmer h-64 rounded-2xl" />
            <div className="kg-shimmer h-52 rounded-2xl" />
          </div>
        </div>
      ) : (
        body
      )}
    </div>
  );
}
