import { describe, expect, it } from "vitest";
import { REQUESTED_SCOPES } from "../shopify/connect";
import { permissionGroups } from "./permissions";

const state = (scopes: string, id: string) => permissionGroups(scopes).writes.find((r) => r.id === id)?.state;

describe("permissionGroups: customer segments", () => {
  it("shows the segment write as not granted until write_customers is granted", () => {
    expect(state("read_customers,write_discounts", "customer_segments")).toBe("not_granted");
    expect(state("write_customers", "customer_segments")).toBe("granted");
  });

  it("counts write_customers as the customer read too, because Shopify lists only the write scope", () => {
    expect(permissionGroups("write_customers").reads.find((r) => r.id === "customers")?.state).toBe("granted");
  });

  it("is asked for at install", () => {
    expect(REQUESTED_SCOPES).toContain("write_customers");
  });
});
