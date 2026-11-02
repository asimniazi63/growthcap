"use client";

import { useSyncExternalStore } from "react";

// True on a Mac, where the shortcut is written "⌘K". The server and the first client render both say false, so nothing mismatches.
const noSubscription = () => () => undefined;
const onMac = () => /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);

export const useIsMac = (): boolean => useSyncExternalStore(noSubscription, onMac, () => false);
