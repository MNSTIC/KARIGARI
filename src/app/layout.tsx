import type { Metadata, Viewport } from "next";
import { Fraunces, IBM_Plex_Mono, Inter, Playfair_Display } from "next/font/google";
import "./globals.css";
import { OfflineSyncProvider } from "@/components/OfflineSyncProvider";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
});

/**
 * The display face. Every big editorial heading and figure is set in this —
 * the page titles, the scheme and product names, the rupee totals.
 *
 * Playfair stays loaded behind it as the fallback the app already shipped, and
 * `globals.css` keeps Inter last in the serif stack so U+20B9 always has a font
 * that can draw it. Weights are pinned rather than loading the full variable
 * range: 400 for the rare serif body line, 600/700 for headings. (`axes` is
 * not compatible with a fixed weight list, so the optical axes stay default.)
 */
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
});

/**
 * The tracked uppercase micro-labels — "ARTISAN VIEW", "MONTHLY OVERVIEW",
 * "ID: PATCH-…". Only two weights, because that is all the labels use.
 */
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

/**
 * The manifest and the Apple tags are what make this installable.
 *
 * `public/manifest.json` and the service worker have existed since the PWA was
 * wired up, but nothing in the document ever linked to them — so Chrome never
 * offered "Install app" and iOS had no icon to put on the home screen. An
 * artisan who cannot install the app cannot launch it offline, which is the
 * whole point of the offline capture queue.
 */
export const metadata: Metadata = {
  title: "KARIGARI Heritage",
  description: "Fair pay. Proven craft. Every time.",
  manifest: "/manifest.json",
  applicationName: "Karigari",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Karigari",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  formatDetection: { telephone: false },
};

/**
 * `themeColor` lives here, not in `metadata`: it has been deprecated on the
 * metadata export since Next 14 and is ignored there. The colour is the
 * heritage primary, so the Android status bar matches the app chrome.
 */
export const viewport: Viewport = {
  themeColor: "#1A1A1A",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${playfair.variable} ${fraunces.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans text-gray-900 bg-background">
        {/* Mounted once for the whole app so a queued offline capture flushes
            the moment connectivity returns, whatever page is open. */}
        <OfflineSyncProvider />
        {children}
      </body>
    </html>
  );
}
