// The colour schemes a person can choose between, and the one default. Everything else in lib/appearance, the Settings page and
// the root layout reads these lists, so a scheme is added in one place. The colour values themselves live in palettes.ts.

export const SCHEME_IDS = ["sorbet", "ledger", "graphite", "dusk", "lagoon"] as const;
export type SchemeId = (typeof SCHEME_IDS)[number];

// What a person picks for light or dark. "system" follows the device; the page resolves it to one of the other two.
export const MODE_PREFS = ["light", "dark", "system"] as const;
export type ModePref = (typeof MODE_PREFS)[number];
export type Mode = "light" | "dark";

export interface Appearance {
  scheme: SchemeId;
  mode: ModePref;
}

// Used for anyone with no cookie, or a cookie that does not parse. Lagoon is the teal the app had before schemes existed.
export const DEFAULT_APPEARANCE: Appearance = { scheme: "sorbet", mode: "system" };

// <html> carries three attributes: data-scheme, data-pref (what the person chose) and data-mode (light or dark, resolved).
export const APPEARANCE_COOKIE = "oasis-appearance";

// Fired on window when the page's appearance changes. The inline script in the root layout and useAppearance both use this name.
export const APPEARANCE_EVENT = "oasis:appearance";

export const SCHEME_INFO: Record<SchemeId, { name: string; description: string }> = {
  sorbet: { name: "Sorbet", description: "Orange on navy. Friendly and dashboard-like, with a navy side rail." },
  ledger: { name: "Ledger", description: "Pen-blue on pale ledger-green paper. Calm, like a checked set of books." },
  graphite: { name: "Graphite", description: "Neutral ink and paper. Colour only ever means ahead or behind." },
  dusk: { name: "Dusk", description: "Deep indigo with a soft periwinkle accent. Easy on the eyes at night." },
  lagoon: { name: "Lagoon", description: "The teal the app has used until now." },
};

export const MODE_LABEL: Record<ModePref, string> = { light: "Light", dark: "Dark", system: "Match my device" };

export const isSchemeId = (v: unknown): v is SchemeId => typeof v === "string" && (SCHEME_IDS as readonly string[]).includes(v);
export const isModePref = (v: unknown): v is ModePref => typeof v === "string" && (MODE_PREFS as readonly string[]).includes(v);
