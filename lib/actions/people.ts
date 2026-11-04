// The names on the Actions page. A ledger row keeps only Clerk user ids (`owner`, `decidedBy`); the page asks Clerk for the names of the
// people in the list it is about to draw, so a card can say "Asim Hameed Khan" instead of "user …4abcde".
// Only a name is used: first and last name, else the username. An email address is never shown, and a person with no name set stays
// as their id. A failed lookup returns no names, so the page falls back to the ids and still draws.

// The fields of a Clerk user this reads. Nothing else is taken from the user.
export interface RawUser {
  id: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
}

export type FetchUsers = (ids: string[]) => Promise<RawUser[]>;

const MAX_PEOPLE = 100; // the longest list one page asks Clerk about
const MAX_NAME = 80;

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

export function displayName(user: RawUser): string | null {
  const full = clean(`${clean(user.firstName)} ${clean(user.lastName)}`);
  const name = full !== "" ? full : clean(user.username);
  return name === "" ? null : name.slice(0, MAX_NAME);
}

// Loaded lazily, so that code and tests that inject their own lookup never pull in Clerk (as lib/portfolio/memberships.ts does).
export const clerkUsers: FetchUsers = async (ids) => {
  const { clerkClient } = await import("@clerk/nextjs/server");
  const client = await clerkClient();
  const page = await client.users.getUserList({ userId: ids, limit: ids.length });
  return page.data.map((u) => ({ id: u.id, firstName: u.firstName, lastName: u.lastName, username: u.username }));
};

// id -> name for the people in `ids` that have one. The ids come from the ledger rows of the signed-in brand, never from a request.
export async function namesFor(ids: ReadonlyArray<string | null | undefined>, fetchUsers: FetchUsers = clerkUsers): Promise<Record<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => typeof id === "string" && id !== ""))].slice(0, MAX_PEOPLE);
  if (wanted.length === 0) return {};
  try {
    const out: Record<string, string> = Object.create(null);
    for (const u of await fetchUsers(wanted)) {
      const name = wanted.includes(u.id) ? displayName(u) : null;
      if (name) out[u.id] = name;
    }
    return { ...out };
  } catch {
    return {};
  }
}
