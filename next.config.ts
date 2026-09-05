import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";

/**
 * Offline-first service worker.
 *
 * The plugin was already registering a worker, but with none of the options
 * that make a cold offline launch work: nothing pre-warmed the app shell on
 * client navigation and there was no document fallback, so relaunching with the
 * radio off landed on the browser's own offline error instead of Karigari.
 * That is fatal for the artisan this app is built for — the offline capture
 * queue is worthless if the app itself will not open.
 *
 * `disable` in development is deliberate and stays: a service worker in
 * `next dev` caches stale chunks and makes HMR lie. Offline behaviour has to be
 * tested against a production build (Vercel, or `next build && next start`).
 */
const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
  // Warm the cache as the artisan navigates while they still have signal, so
  // the pages they actually use are there when the signal goes.
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  // Coming back online re-fetches the page rather than leaving them on a stale
  // shell — the same moment the capture queue flushes.
  reloadOnOnline: true,
  // A cold offline launch serves this instead of the dinosaur.
  fallbacks: { document: "/offline" },
  // Keep every default rule (next/image, RSC payloads, JSON, audio...) and only
  // override the handful named below.
  extendDefaultRuntimeCaching: true,
  workboxOptions: {
    // The worker takes over immediately; an artisan should never have to close
    // every tab to get the offline shell.
    skipWaiting: true,
    clientsClaim: true,
    /**
     * Keep the background-removal model out of the precache.
     *
     * `@imgly/background-removal` ships a 24 MB ONNX runtime that is already
     * lazily imported — it is only fetched when an artisan actually enhances a
     * photo. Precaching it would push 24 MB onto a phone on first load, which
     * is exactly the wrong trade for the connections this app targets. The
     * first three patterns are the plugin's own defaults, restated because
     * setting `exclude` replaces them.
     */
    exclude: [/\/_next\/static\/.*(?<!\.p)\.woff2/, /\.map$/, /^manifest.*\.js$/, /ort-wasm.*\.wasm$/],
    runtimeCaching: [
      {
        // App shell / navigations. NetworkFirst with a short timeout: on a weak
        // 2G connection waiting 10s for a document the cache already holds is
        // indistinguishable from being broken.
        urlPattern: ({ url, sameOrigin }: { url: URL; sameOrigin: boolean }) =>
          sameOrigin && !url.pathname.startsWith("/api/"),
        handler: "NetworkFirst",
        options: {
          cacheName: "pages",
          networkTimeoutSeconds: 4,
          expiration: { maxEntries: 64, maxAgeSeconds: 60 * 60 * 24 * 7 },
        },
      },
      {
        // Item thumbnails. The route streams a stored capture and the bytes
        // never change for a given id, so this is the one class of response
        // worth holding for a month — it is also the heaviest thing a list
        // view fetches on a weak link.
        urlPattern: ({ url, sameOrigin }: { url: URL; sameOrigin: boolean }) =>
          sameOrigin && /^\/api\/items\/[^/]+\/thumbnail/.test(url.pathname),
        handler: "CacheFirst",
        options: {
          cacheName: "item-thumbnails",
          expiration: { maxEntries: 256, maxAgeSeconds: 60 * 60 * 24 * 30 },
          cacheableResponse: { statuses: [0, 200] },
        },
      },
      {
        // Read-only dashboard/board GETs. NetworkFirst with a 3s ceiling: on a
        // 2G tap the artisan gets yesterday's view immediately rather than a
        // spinner, and the fresh copy lands on the next poll. Mutating routes
        // are excluded by the GET check — a queued capture must never be
        // answered from cache.
        urlPattern: ({ url, sameOrigin, request }: { url: URL; sameOrigin: boolean; request: Request }) =>
          sameOrigin &&
          request.method === "GET" &&
          /^\/api\/(artisan|buyer|demand|creators|items\/market|admin)\//.test(url.pathname),
        handler: "NetworkFirst",
        options: {
          cacheName: "api-reads",
          networkTimeoutSeconds: 3,
          expiration: { maxEntries: 128, maxAgeSeconds: 60 * 60 * 24 },
          cacheableResponse: { statuses: [0, 200] },
        },
      },
      {
        // Static chunks and the app's own assets. Revalidating in the
        // background keeps a deploy fresh without blocking first paint.
        urlPattern: /\.(?:js|css|woff2?|ttf|otf|png|jpg|jpeg|gif|svg|webp|avif|ico)$/i,
        handler: "StaleWhileRevalidate",
        options: {
          cacheName: "static-assets",
          expiration: { maxEntries: 128, maxAgeSeconds: 60 * 60 * 24 * 30 },
        },
      },
      {
        urlPattern: /^https:\/\/fonts\.(?:googleapis|gstatic)\.com\/.*/i,
        handler: "CacheFirst",
        options: {
          cacheName: "google-fonts-webfonts",
          expiration: { maxEntries: 16, maxAgeSeconds: 60 * 60 * 24 * 365 },
          cacheableResponse: { statuses: [0, 200] },
        },
      },
    ],
  },
});

const nextConfig: NextConfig = {
  turbopack: {},
  // Phones on the LAN hit the dev server by IP, which is a different origin
  // from localhost. Without this, the hot-reload socket is refused and the
  // console fills with WebSocket handshake errors on every page.
  allowedDevOrigins: ['192.168.29.230', '*.trycloudflare.com', '*.ngrok-free.app', '*.loca.lt'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'api.qrserver.com',
      },
    ],
  },
};

export default withPWA(nextConfig);
