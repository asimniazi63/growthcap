import { describe, expect, it, vi } from "vitest";
import { displayName, namesFor, type RawUser } from "./people";

// The names on the Actions page. A ledger row keeps only Clerk user ids; the page asks Clerk for the names of the people in the list.
// Only a name is shown: a person with no name set is left as their id, never given their email address.

const user = (over: Partial<RawUser> = {}): RawUser => ({ id: "user_1", firstName: null, lastName: null, username: null, ...over });

describe("displayName", () => {
  it("is the first and last name, trimmed", () => {
    expect(displayName(user({ firstName: "Asim", lastName: "Hameed Khan" }))).toBe("Asim Hameed Khan");
    expect(displayName(user({ firstName: " Asim ", lastName: null }))).toBe("Asim");
    expect(displayName(user({ firstName: null, lastName: "Khan" }))).toBe("Khan");
  });

  it("falls back to the username, and to nothing, never to an email address", () => {
    expect(displayName(user({ username: "asim.k" }))).toBe("asim.k");
    expect(displayName(user({ firstName: "  ", lastName: "", username: " " }))).toBeNull();
    expect(displayName({ ...user(), emailAddresses: [{ emailAddress: "a@b.co" }] } as RawUser)).toBeNull();
  });

  it("keeps a name to a sensible length", () => {
    expect(displayName(user({ firstName: "x".repeat(300) }))!.length).toBeLessThanOrEqual(80);
  });
});

describe("namesFor", () => {
  it("looks up each distinct id once, and returns a name for those that have one", async () => {
    const fetchUsers = vi.fn(async (ids: string[]) => ids.map((id) => user({ id, firstName: id === "user_a" ? "Ada" : null, lastName: id === "user_a" ? "Lovelace" : null })));
    const names = await namesFor(["user_a", "user_b", "user_a", "", null, undefined], fetchUsers);
    expect(fetchUsers).toHaveBeenCalledTimes(1);
    expect(fetchUsers).toHaveBeenCalledWith(["user_a", "user_b"]);
    expect(names).toEqual({ user_a: "Ada Lovelace" });
  });

  it("asks for nothing, and returns nothing, when there are no ids", async () => {
    const fetchUsers = vi.fn(async () => []);
    expect(await namesFor([], fetchUsers)).toEqual({});
    expect(await namesFor([null, undefined], fetchUsers)).toEqual({});
    expect(fetchUsers).not.toHaveBeenCalled();
  });

  it("returns no names, and no error, when the lookup fails, so the page falls back to the ids", async () => {
    expect(await namesFor(["user_a"], async () => Promise.reject(new Error("clerk is down")))).toEqual({});
  });

  it("asks for at most 100 people, however long the list is", async () => {
    const fetchUsers = vi.fn(async (ids: string[]) => ids.map((id) => user({ id, firstName: "N" })));
    const ids = Array.from({ length: 150 }, (_, i) => `user_${i}`);
    const names = await namesFor(ids, fetchUsers);
    expect(fetchUsers.mock.calls[0]![0]).toHaveLength(100);
    expect(Object.keys(names)).toHaveLength(100);
  });

  it("ignores a user the lookup returns that was not asked for", async () => {
    const names = await namesFor(["user_a"], async () => [user({ id: "user_a", firstName: "Ada" }), user({ id: "user_z", firstName: "Zed" })]);
    expect(names).toEqual({ user_a: "Ada" });
  });
});
