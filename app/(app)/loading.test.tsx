import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

// Every route under app/(app) that loads data has a loading.tsx. Each one renders without crashing, announces Loading once, is made of
// the skeleton blocks, and has no spinner.
const ROOT = resolve(process.cwd(), "app/(app)");
const ROUTES = ["overview", "pace", "portfolio", "chat", "segments", "playbooks", "audit", "actions", "briefs", "plan", "connect", "settings"];

function loadingFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? loadingFiles(join(dir, e.name)) : e.name === "loading.tsx" ? [join(dir, e.name)] : []));
}

describe("loading.tsx files", () => {
  const files = loadingFiles(ROOT);

  it("exist for the app shell and for every data route", () => {
    const have = files.map((f) => f.slice(ROOT.length + 1));
    expect(have).toContain("loading.tsx");
    for (const r of ROUTES) expect(have, `${r}/loading.tsx`).toContain(`${r}/loading.tsx`);
  });

  it.each(files.map((f) => [f.slice(ROOT.length + 1), f]))("%s renders a skeleton", async (_name, file) => {
    const mod = (await import(/* @vite-ignore */ file)) as { default: () => React.ReactElement };
    const out = renderToStaticMarkup(mod.default());
    expect(out).toContain('role="status"');
    expect(out).toContain('aria-busy="true"');
    expect(out.match(/<span class="sr-only">Loading<\/span>/g)).toHaveLength(1);
    expect(out).toContain('class="skeleton');
    expect(out).not.toMatch(/animate-spin|spinner|Loader/i);
  });
});
