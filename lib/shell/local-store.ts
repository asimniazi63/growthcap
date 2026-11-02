// Small values kept in this browser (localStorage). Every call can fail, because storage can be blocked, full or missing
// (private windows, embedded frames, the server), so each one falls back to "nothing there" instead of throwing.

export interface StoreLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function browserStore(): StoreLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readRaw(store: StoreLike | null, key: string): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

// Returns whether the value was kept. `null` removes the key.
export function writeRaw(store: StoreLike | null, key: string, value: string | null): boolean {
  if (!store) return false;
  try {
    if (value === null) store.removeItem(key);
    else store.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

// Another tab changing a value fires the browser's "storage" event; a change in this tab needs its own signal.
export const STORE_EVENT = "oasis:store";

export interface StoreChange {
  key: string;
  added?: string; // the id of an item that was just added, so its card can settle in
}

export function announceChange(change: StoreChange): void {
  window.dispatchEvent(new CustomEvent<StoreChange>(STORE_EVENT, { detail: change }));
}

export function subscribeStore(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(STORE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(STORE_EVENT, onChange);
  };
}
