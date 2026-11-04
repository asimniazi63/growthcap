// Pages that only Growth Capital admins and partners may open. Each page enforces this itself on the server; the sidebar and the
// command palette read this one list so they never offer a link that leads to a "Growth Capital roles only" screen.
export const GC_ONLY_PAGES: readonly string[] = ["/portfolio", "/audit", "/playbooks", "/segments", "/plan", "/actions"];

// Pages only a Growth Capital admin may open. Same idea: the page checks the role itself, and the sidebar and the command palette read
// this list so they never offer a link that leads to an "admins only" screen.
export const ADMIN_ONLY_PAGES: readonly string[] = ["/team"];

// Whether a person may be offered a page. The command palette asks this for every page it lists.
export const canOpenPage = (href: string, gc: boolean, admin: boolean): boolean => (gc || !GC_ONLY_PAGES.includes(href)) && (admin || !ADMIN_ONLY_PAGES.includes(href));
