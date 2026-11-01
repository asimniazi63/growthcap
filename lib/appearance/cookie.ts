import { APPEARANCE_COOKIE, DEFAULT_APPEARANCE, isModePref, isSchemeId, type Appearance } from "./schemes";

// The cookie holds "<scheme>.<mode>", for example "sorbet.dark". It is a preference, not a credential: it carries no tenant and no
// user id. The server reads it on every request, so anything that is not exactly a known scheme and mode falls back to the default.

export function parseAppearance(raw: string | null | undefined): Appearance {
  const [scheme, mode] = (raw ?? "").split(".");
  return {
    scheme: isSchemeId(scheme) ? scheme : DEFAULT_APPEARANCE.scheme,
    mode: isModePref(mode) ? mode : DEFAULT_APPEARANCE.mode,
  };
}

export const serializeAppearance = (a: Appearance): string => `${a.scheme}.${a.mode}`;

// The full string to assign to document.cookie: one year, whole site, Lax, and Secure on https.
export function cookieString(a: Appearance, secure: boolean): string {
  return `${APPEARANCE_COOKIE}=${serializeAppearance(a)}; Path=/; Max-Age=31536000; SameSite=Lax${secure ? "; Secure" : ""}`;
}
