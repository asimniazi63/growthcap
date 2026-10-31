import type { Metadata } from "next";
import { Bricolage_Grotesque, Instrument_Sans } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

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
          colorPrimary: "#0f766e",
          colorForeground: "#0e1f22",
          colorMutedForeground: "#44585c",
          colorBackground: "#ffffff",
          colorInput: "#ffffff",
          borderRadius: "0.625rem",
          fontFamily: "var(--font-ui-face), ui-sans-serif, system-ui, sans-serif",
        },
      }}
    >
      <html lang="en" className={`${display.variable} ${ui.variable}`}>
        <body className="min-h-screen">{children}</body>
      </html>
    </ClerkProvider>
  );
}
