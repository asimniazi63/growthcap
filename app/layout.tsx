import type { Metadata } from "next";
import { Bricolage_Grotesque, Instrument_Sans } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

// Runs before first paint so a dark page never flashes light: the saved choice, else the system setting.
const themeScript = `try{var t=localStorage.getItem("oasis-theme");if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=t}catch(e){}`;

const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-display-face", display: "swap" });
const ui = Instrument_Sans({ subsets: ["latin"], variable: "--font-ui-face", display: "swap" });

export const metadata: Metadata = {
  title: "Oasis Pace",
  description: "Ask questions about a store's data and get numbers you can verify.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
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
      <html lang="en" className={`${display.variable} ${ui.variable}`} suppressHydrationWarning>
        <head>
          <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        </head>
        <body className="min-h-screen">{children}</body>
      </html>
    </ClerkProvider>
  );
}
