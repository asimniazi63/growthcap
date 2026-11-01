// Pages that only Growth Capital admins and partners may open. Each page enforces this itself on the server; the sidebar and the
// command palette read this one list so they never offer a link that leads to a "Growth Capital roles only" screen.
export const GC_ONLY_PAGES: readonly string[] = ["/portfolio", "/audit", "/playbooks", "/segments", "/plan", "/actions"];
