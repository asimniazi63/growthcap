import type { Metadata } from "next";
import { Bricolage_Grotesque, Instrument_Sans, Lexend } from "next/font/google";
import { cookies } from "next/headers";
import { ClerkProvider } from "@clerk/nextjs";
import { parseAppearance } from "@/lib/appearance/cookie";
import { appearanceScript } from "@/lib/appearance/script";
import { APPEARANCE_COOKIE } from "@/lib/appearance/schemes";
import "./globals.css";

// The server renders data-scheme, data-pref and data-mode from the cookie, so a fixed scheme or mode has no flash. The script that
// handles "match my device" and the move from the old light/dark setting is in lib/appearance/script.ts.
const appearanceInline = appearanceScript();

const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-display-face", display: "swap" });
const ui = Instrument_Sans({ subsets: ["latin"], variable: "--font-ui-face", display: "swap" });
// Only the Sorbet scheme maps the font variables to Lexend, and preload is off so other schemes never download it.
const lexend = Lexend({ subsets: ["latin"], variable: "--font-lexend", display: "swap", preload: false });

export const metadata: Metadata = {
  title: "Oasis Pace",
  description: "Ask questions about a store's data and get numbers you can verify.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  const { scheme, mode } = parseAppearance(jar.get(APPEARANCE_COOKIE)?.value);

  return (
    <ClerkProvider
      appearance={{
        variables: {
          colorPrimary: "var(--color-brand)",
          colorForeground: "var(--color-ink)",
          colorMutedForeground: "var(--color-ink-2)",
          colorBackground: "var(--color-surface)",
          colorInput: "var(--color-surface)",
          colorNeutral: "var(--color-ink)",
          colorPrimaryForeground: "var(--color-on-brand)",
          borderRadius: "0.625rem",
          fontFamily: "var(--font-ui-face), ui-sans-serif, system-ui, sans-serif",
        },
      }}
    >
      <html
        lang="en"
        data-scheme={scheme}
        data-pref={mode}
        data-mode={mode === "system" ? "light" : mode}
        className={`${display.variable} ${ui.variable} ${lexend.variable}`}
        suppressHydrationWarning
      >
        <head>
          <script dangerouslySetInnerHTML={{ __html: appearanceInline }} />
        </head>
        <body className="min-h-screen">{children}</body>
      </html>
    </ClerkProvider>
  );
}
