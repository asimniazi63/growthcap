import type { ReactNode } from "react";
import { Brand } from "@/components/shell/brand";
import { ThemeToggle } from "@/components/shell/theme-toggle";

// The signed-out screens: the brand, one line on what the app does, then the sign-in form, centred on the paper background.
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative grid min-h-screen place-items-center bg-paper px-4 py-10">
      <ThemeToggle className="absolute right-4 top-4" />
      <div className="w-full max-w-md">
        <div className="mb-7 flex flex-col items-center gap-2.5 text-center">
          <Brand href="/sign-in" className="text-[1.375rem]" />
          <p className="muted text-sm">Ask about a store&apos;s data and get numbers you can verify.</p>
        </div>
        {children}
      </div>
    </div>
  );
}
