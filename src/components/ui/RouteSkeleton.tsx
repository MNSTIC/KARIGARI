/**
 * Instant placeholder shown while an artisan route hydrates and fetches.
 *
 * These pages are client components that load their own data, so before this
 * existed a navigation showed a blank background until the first fetch
 * resolved. Next renders `loading.tsx` immediately on navigation, which makes
 * the app feel responsive without changing a single query.
 *
 * Server component on purpose: no hooks, no client JS, nothing to hydrate.
 */
export function RouteSkeleton({ cards = 4 }: { cards?: number }) {
  return (
    <div className="min-h-screen bg-[var(--color-background)] font-sans">
      {/* Header bar */}
      <div className="bg-white border-b border-gray-200 px-4 sm:px-6 py-4 flex items-center gap-4">
        <div className="h-7 w-7 rounded-full bg-gray-100 animate-pulse" />
        <div className="h-5 w-40 rounded bg-gray-100 animate-pulse" />
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <div className="h-8 w-56 rounded-lg bg-gray-100 animate-pulse mb-3" />
        <div className="h-4 w-72 rounded bg-gray-100 animate-pulse mb-8" />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: cards }).map((_, i) => (
            <div
              key={i}
              className="bg-card rounded-2xl border border-gray-100 shadow-card p-5"
              /* Staggered so the shimmer reads as a loading state rather than a
                 flat grey block. */
              style={{ animationDelay: `${i * 90}ms` }}
            >
              <div className="h-32 rounded-xl bg-gray-100 animate-pulse mb-4" />
              <div className="h-4 w-3/4 rounded bg-gray-100 animate-pulse mb-2" />
              <div className="h-3 w-1/2 rounded bg-gray-100 animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
