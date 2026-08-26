import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
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
