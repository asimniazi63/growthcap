import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_APPEARANCE, MODE_LABEL, MODE_PREFS, SCHEME_IDS, SCHEME_INFO } from "@/lib/appearance/schemes";
import { AppearanceForm } from "./appearance-form";

// The repo has no browser-like DOM for tests, so this runs in plain Node. The page's <html> attributes and the cookie are a small stand-in,
// the two React hooks the appearance hook uses are made to run outside a render, and the form's element tree is read directly. The real
// hook and the real form run unchanged, so what is checked is what a person's click would do.
const show = vi.hoisted(() => vi.fn());
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ show }) }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useSyncExternalStore: <T,>(_subscribe: unknown, snapshot: () => T) => snapshot(), useCallback: <T,>(fn: T) => fn };
});

let root: { dataset: Record<string, string> };
let jar: string[];

beforeEach(() => {
  show.mockClear();
  jar = [];
  root = { dataset: { scheme: DEFAULT_APPEARANCE.scheme, pref: DEFAULT_APPEARANCE.mode, mode: "light" } };
  vi.stubGlobal("document", {
    documentElement: root,
    get cookie() {
      return jar.join("; ");
    },
    set cookie(value: string) {
      jar.push(value);
    },
  });
  vi.stubGlobal("window", {
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => true,
    matchMedia: () => ({ matches: false }),
    location: { protocol: "http:" },
  });
});

type Props = { type?: string; name?: string; value?: string; "aria-label"?: string; onChange?: () => void; onClick?: () => void; children?: ReactNode };

// Visits every element the form draws, opening the plain function components (the heading, the thumbnail) on the way.
function elements(node: ReactNode, found: ReactElement<Props>[] = []): ReactElement<Props>[] {
  if (Array.isArray(node)) {
    node.forEach((n) => elements(n, found));
  } else if (isValidElement<Props>(node)) {
    found.push(node);
    elements(typeof node.type === "function" ? (node.type as (p: Props) => ReactNode)(node.props) : node.props.children, found);
  }
  return found;
}

const tree = () => elements(AppearanceForm());
const radio = (name: string, value: string) => {
  const found = tree().find((e) => e.type === "input" && e.props.type === "radio" && e.props.name === name && e.props.value === value);
  if (!found) throw new Error(`no ${name} radio with value ${value}`);
  return found.props;
};
const html = () => renderToStaticMarkup(<AppearanceForm />);
// The values of the radios that are checked, in page order: the scheme first, then the mode.
const checkedValues = (out: string) =>
  (out.match(/<input[^>]*>/g) ?? []).filter((tag) => tag.includes('checked=""')).map((tag) => /value="([^"]+)"/.exec(tag)?.[1]);
const lastCookie = () => jar[jar.length - 1] ?? "";

describe("AppearanceForm", () => {
  it("draws two labelled radio groups, one radio per scheme and per mode, and the reset button", () => {
    const out = html();
    expect(out.match(/role="radiogroup"/g)).toHaveLength(2);
    expect(out.match(/type="radio"/g)).toHaveLength(SCHEME_IDS.length + MODE_PREFS.length);
    for (const id of SCHEME_IDS) {
      expect(out).toContain(`aria-label="${SCHEME_INFO[id].name}"`);
      expect(out).toContain(SCHEME_INFO[id].description);
    }
    for (const pref of MODE_PREFS) expect(out).toContain(MODE_LABEL[pref]);
    expect(out).toContain("Saved in this browser");
    expect(out).toContain("does not follow you to other browsers");
    expect(out).toContain("Reset to default");
    // each group names itself with the heading above it
    expect(out).toMatch(/aria-labelledby="appearance-scheme-heading"/);
    expect(out).toMatch(/aria-labelledby="appearance-mode-heading"/);
  });

  it("marks only the default scheme with a Default badge", () => {
    const out = html();
    expect(out.match(/>Default</g)).toHaveLength(1);
    expect(out).toContain(`${SCHEME_INFO[DEFAULT_APPEARANCE.scheme].name}<span class="badge badge-brand">Default</span>`);
  });

  it("checks the current scheme and mode, and draws every thumbnail in the current mode", () => {
    const out = html();
    expect(checkedValues(out)).toEqual([DEFAULT_APPEARANCE.scheme, DEFAULT_APPEARANCE.mode]);
    for (const id of SCHEME_IDS) expect(out).toContain(`data-scheme="${id}" data-mode="light"`);
  });

  it("choosing Ledger sets the scheme on the page, saves the cookie, keeps the mode, and confirms", () => {
    radio("scheme", "ledger").onChange?.();
    expect(root.dataset.scheme).toBe("ledger");
    expect(root.dataset.pref).toBe(DEFAULT_APPEARANCE.mode);
    expect(lastCookie()).toContain("oasis-appearance=ledger.");
    expect(show).toHaveBeenCalledWith("Appearance saved in this browser.");
    expect(checkedValues(html())).toEqual(["ledger", DEFAULT_APPEARANCE.mode]);
  });

  it("choosing Dark sets data-pref and data-mode, keeps the scheme, and redraws the thumbnails dark", () => {
    radio("mode", "dark").onChange?.();
    expect(root.dataset.pref).toBe("dark");
    expect(root.dataset.mode).toBe("dark");
    expect(root.dataset.scheme).toBe(DEFAULT_APPEARANCE.scheme);
    expect(lastCookie()).toContain(`oasis-appearance=${DEFAULT_APPEARANCE.scheme}.dark`);
    expect(show).toHaveBeenCalledWith("Appearance saved in this browser.");
    const out = html();
    expect(checkedValues(out)).toEqual([DEFAULT_APPEARANCE.scheme, "dark"]);
    for (const id of SCHEME_IDS) expect(out).toContain(`data-scheme="${id}" data-mode="dark"`);
  });

  it("Reset to default puts the scheme and mode back and confirms", () => {
    radio("scheme", "ledger").onChange?.();
    radio("mode", "dark").onChange?.();
    show.mockClear();
    const reset = tree().find((e) => e.type === "button" && e.props.children === "Reset to default");
    expect(reset).toBeDefined();
    reset?.props.onClick?.();
    expect(root.dataset.scheme).toBe(DEFAULT_APPEARANCE.scheme);
    expect(root.dataset.pref).toBe(DEFAULT_APPEARANCE.mode);
    expect(root.dataset.mode).toBe("light");
    expect(lastCookie()).toContain(`oasis-appearance=${DEFAULT_APPEARANCE.scheme}.${DEFAULT_APPEARANCE.mode}`);
    expect(show).toHaveBeenCalledWith("Back to the default.");
  });
});
