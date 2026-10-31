import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { StoreKey } from "./types.js";

export type JournalKind = "location" | "collection" | "product" | "discount" | "customer" | "order" | "refund" | "inventory";

export interface JournalEntry {
  status: "inflight" | "done";
  shopifyId?: string;
  data?: unknown;
  at: string;
}

interface JournalFile {
  store: StoreKey;
  shop: string;
  entries: Record<string, JournalEntry>;
}

// The loader's local state (.seed-journal/<store>.json, git-ignored). A record is marked in flight BEFORE its
// Shopify call and done AFTER it, so a crash leaves at most the record being created marked in flight.
// Every mark is written to disk straight away (tmp file + rename) so a kill can't truncate the file.
export class Journal {
  private constructor(
    private readonly path: string | null,
    private readonly file: JournalFile,
  ) {}

  static open(path: string | null, meta: { store: StoreKey; shop: string }): Journal {
    if (path && existsSync(path)) {
      const file = JSON.parse(readFileSync(path, "utf8")) as JournalFile;
      if (file.shop !== meta.shop) {
        throw new Error(
          `Journal ${path} was written for a different shop (${file.shop}), not ${meta.shop}. Move it aside if the store was re-created.`,
        );
      }
      return new Journal(path, file);
    }
    return new Journal(path, { store: meta.store, shop: meta.shop, entries: {} });
  }

  private key(kind: JournalKind, genId: string): string {
    return `${kind}:${genId}`;
  }

  get(kind: JournalKind, genId: string): JournalEntry | undefined {
    return this.file.entries[this.key(kind, genId)];
  }

  isDone(kind: JournalKind, genId: string): boolean {
    return this.get(kind, genId)?.status === "done";
  }

  markInflight(kind: JournalKind, genId: string): void {
    this.file.entries[this.key(kind, genId)] = { status: "inflight", at: new Date().toISOString() };
    this.save();
  }

  markDone(kind: JournalKind, genId: string, shopifyId: string, data?: unknown): void {
    this.file.entries[this.key(kind, genId)] = { status: "done", shopifyId, data, at: new Date().toISOString() };
    this.save();
  }

  countDone(kind: JournalKind): number {
    const prefix = `${kind}:`;
    return Object.entries(this.file.entries).filter(([k, e]) => k.startsWith(prefix) && e.status === "done").length;
  }

  private save(): void {
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.file, null, 2));
    renameSync(tmp, this.path);
  }
}
