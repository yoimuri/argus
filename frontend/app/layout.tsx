import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import { ThemeProvider } from "@/components/theme/ThemeProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ARGUS",
  description: "Multi-agent AI research assistant with built-in prompt injection defense.",
};

// Must match ThemeProvider.tsx's storage key and fallback logic exactly --
// same source, read twice (once here before paint, once by React on mount),
// so they never disagree (D11; see Next's flash-prevention guide, "Themes").
const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("argus-theme");var resolved=(t==="light"||t==="dark")?t:(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.setAttribute("data-theme",resolved)}catch(e){}})();`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Server Component reading the per-request nonce proxy.ts generated (D11) --
  // required so this inline script executes under the nonce-based CSP
  // (script-src 'nonce-...') instead of being blocked as an unlisted inline
  // script. See ADR-008 for why the CSP has no 'unsafe-inline' to fall back on.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html
      lang="en"
      data-theme="light"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}