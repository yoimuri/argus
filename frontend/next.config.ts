import type { NextConfig } from "next";

// The two origins the frontend actually talks to. Update both if either
// the Supabase project or the Render backend URL ever changes.
const SUPABASE_URL = "https://gidhqyjzyrcnzpkodymw.supabase.co";
const BACKEND_URL = "https://argus-am5t.onrender.com";

// A static CSP, not nonce-based. Next.js's own docs are explicit that
// nonce-based CSP forces every page into dynamic rendering and disables
// static optimization, real tradeoffs not worth taking on at this stage.
// 'unsafe-inline' on script/style is the real cost of the simpler route,
// Next.js's default hydration and Tailwind's inline styles need it without
// a nonce. Still meaningfully better than no CSP at all: blocks any
// externally-sourced script, restricts frame embedding, restricts object
// sources. See docs/ADR-008.md for the full reasoning.
const cspDirectives = [
  `default-src 'self'`,
  `script-src 'self' 'unsafe-inline'`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data:`,
  `font-src 'self'`,
  `connect-src 'self' ${SUPABASE_URL} ${BACKEND_URL}`,
  `frame-ancestors 'none'`,
  `object-src 'none'`,
  `base-uri 'self'`,
].join("; ");

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: cspDirectives },
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