"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Asks the page to read its data again, once, when it mounts. A component renders this only after something changed (an
// approval), so a card rendered to static markup never needs the app router.
export function RefreshNow() {
  const router = useRouter();
  useEffect(() => {
    router.refresh();
  }, [router]);
  return null;
}
