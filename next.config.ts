import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";
import fs from "fs";
import path from "path";

/**
 * The server cutout route loads the `medium` matting model (see
 * src/app/api/items/background/route.ts). Its weights are split into chunks
 * named by hash and listed in the package's resources.json; read that list so
 * the trace carries exactly those files and not the unused `small` model.
 * An empty list (package not installed) simply adds nothing.
 */
const MEDIUM_MODEL_CHUNKS: string[] = (() => {
  try {
    const dist = path.join(process.cwd(), "node_modules/@imgly/background-removal-node/dist");
    const resources = JSON.parse(fs.readFileSync(path.join(dist, "resources.json"), "utf8")) as Record<
      string,
      { chunks: { hash: string }[] }
    >;
    const hashes = new Set((resources["/models/medium"]?.chunks ?? []).map((chunk) => chunk.hash));
    return [...hashes].map((hash) => `./node_modules/@imgly/background-removal-node/dist/${hash}`);
  } catch {
    return [];
  }
})();

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
        // The learn page keeps its own saved copy of this answer in IndexedDB
        // (src/lib/learningCache.ts) and tells the artisan when it is showing
        // it. If the worker answered from its cache too, a stale response would
        // look fresh and the page could never say so — so this one route always
        // goes to the network, and fails honestly when there is none.
        urlPattern: ({ url, sameOrigin }: { url: URL; sameOrigin: boolean }) =>
          sameOrigin && url.pathname === "/api/artisan/learning-recommendations",
        handler: "NetworkOnly",
      },
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
  /**
   * The server background-removal route loads a native ONNX runtime and a
   * matting model. Bundling either breaks them (they resolve binaries relative
   * to their own package), so both are left to Node's own `require`.
   */
  serverExternalPackages: ['@imgly/background-removal-node', 'onnxruntime-node'],
  /**
   * What the server cutout route needs on a Linux x64 host, and nothing else.
   *
   * Measured from `.next/server/app/api/items/background/route.js.nft.json`:
   *   - File tracing picks up `onnxruntime_binding.node` but NOT the
   *     `libonnxruntime.so.1.17.3` it dynamically links, and NOT the model: the
   *     matting weights are 22 hash-named chunks the package resolves at runtime
   *     through `dist/resources.json`, invisible to static tracing. Without the
   *     includes below the route deploys, then fails on every call.
   *   - It also traces the macOS and Windows bindings (~100 MB) a Linux host
   *     never loads.
   * Result on Linux x64: ~124 MB (84 MB model, 19 MB ONNX runtime, 18 MB libvips,
   * the rest code) against a 250 MB per-function limit.
   *
   * Excludes are only honoured on a POSIX build machine: Next 16.3 joins the
   * exclude globs with the OS path separator, and on Windows the backslashes
   * reach picomatch as escapes. A local Windows build therefore over-reports the
   * size; the deploy build (Linux) does not. See docs/PHOTO_STUDIO_RUNBOOK.md.
   */
  outputFileTracingIncludes: {
    '/api/items/background': [
      './node_modules/onnxruntime-node/bin/napi-v3/linux/x64/*',
      './node_modules/@imgly/background-removal-node/dist/resources.json',
      ...MEDIUM_MODEL_CHUNKS,
    ],
  },
  outputFileTracingExcludes: {
    '/api/items/background': [
      './node_modules/onnxruntime-node/bin/napi-v3/darwin/**/*',
      './node_modules/onnxruntime-node/bin/napi-v3/win32/**/*',
      './node_modules/onnxruntime-node/bin/napi-v3/linux/arm64/**/*',
    ],
  },
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
      {
        // Google profile photos, for an artisan who signed up with Google.
        // Without this entry `next/image` throws "hostname is not configured"
        // and the very first screen of a brand-new account renders a crash
        // overlay in dev and a broken avatar in production. The path is
        // narrowed to `/a/` because that is where Google serves account
        // pictures; nothing else on that CDN should be proxied by us.
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
        pathname: '/a/**',
      },
    ],
  },
};

export default withPWA(nextConfig);
