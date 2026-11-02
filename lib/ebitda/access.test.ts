import { describe, expect, it } from "vitest";
import { NotAllowedError } from "../memory/store";
import { ROLES } from "../tenancy/context";
import { assertCanEditCostSheet, canEditCostSheet } from "./access";

describe("who may edit the cost sheet", () => {
  it.each([
    ["gc_admin", true],
    ["gc_partner", true],
    ["client_viewer", false],
  ] as const)("%s: %s", (role, allowed) => {
    expect(canEditCostSheet({ role })).toBe(allowed);
    if (allowed) expect(() => assertCanEditCostSheet({ role })).not.toThrow();
    else expect(() => assertCanEditCostSheet({ role })).toThrow(NotAllowedError); // the API helpers answer this with 403 FORBIDDEN
  });

  it("covers every role, so a new role has to be decided here", () => {
    expect([...ROLES].sort()).toEqual(["client_viewer", "gc_admin", "gc_partner"]);
  });
});
