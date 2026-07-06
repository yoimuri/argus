import type { NextConfig } from "next";

// Content-Security-Policy moved to proxy.ts (ADR-008 addendum): a per-request
// nonce requires setting the header per-request, which next.config.ts's static
// headers() cannot do. The four headers below don't need per-request values,
// so they stay here.
const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;