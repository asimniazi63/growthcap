import type { UIMessageChunk } from "ai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ExtraToolDeps } from "../agent/extra-types";
import type { Db } from "../db/client";
import { AppError } from "../errors";
import type { TenantContext } from "../tenancy/context";
import { annotationExecutor } from "./executors/annotation";
import { discountDeactivateExecutor } from "./executors/discount-deactivate";
import { metricTargetExecutor } from "./executors/metric-target";
import { segmentCreateExecutor } from "./executors/segment-create";
import { buildProposeActionTool, proposeActionInput, proposeActionUnion } from "./tool";
import type { ActionView, ProposeInput } from "./types";

const ctx: TenantContext = { tenantId: "t1", orgId: "org_a", userId: "u1", role: "gc_partner", shop: null };
const db = {} as Db;

const view = (over: Partial<ActionView> = {}): ActionView => ({
  id: "6f1f6c1e-0000-4000-8000-000000000001", kind: "metric_target", status: "proposed", title: "Set November net sales target",
  diff: { summary: "Set a total sales target of $12,000.00 for November 2026 in the store's Shopify analytics." },
  hypothesis: "h", metric: "net_sales", checkOn: "2026-12-01", owner: "u1", dryRun: false, createdAt: "2026-11-02T00:00:00.000Z", ...over,
});

function setup(impl: (db: Db, ctx: TenantContext, input: ProposeInput) => Promise<ActionView> = async () => view()) {
  const propose = vi.fn(impl);
  const written: UIMessageChunk[] = [];
  const steps: { tool: string; ok: boolean; errorCode?: string }[] = [];
  const d: ExtraToolDeps = {
    ctx, db, model: {} as never, now: new Date("2026-11-02T12:00:00Z"), calls: new Map(),
    write: (c) => written.push(c),
    onStep: (e) => steps.push(e),
  };
  const t = buildProposeActionTool(d, propose);
  const call = (input: unknown) => (t.execute as unknown as (i: unknown, o: unknown) => Promise<unknown>)(input, { toolCallId: "c1", messages: [] });
  return { call, propose, written, steps };
}

const common = { title: "Set November net sales target", hypothesis: "A written target keeps the team on pace", checkOn: "2026-12-01" };
const target = { kind: "metric_target", metric: "net_sales", month: "2026-11", value: 1_200_000, ...common };

describe("propose_action", () => {
  it("proposes, shows the card, and tells the model nothing it could misquote", async () => {
    const s = setup();
    const out = await s.call(target);
    expect(out).toEqual({ proposed: true, actionId: view().id, needsApproval: true });
    expect(s.propose).toHaveBeenCalledWith(db, ctx, {
      kind: "metric_target", title: common.title, hypothesis: common.hypothesis, metric: "net_sales", checkOn: "2026-12-01",
      payload: { metric: "net_sales", month: "2026-11", value: 1_200_000 },
    });
    expect(s.written).toEqual([{ type: "data-action", data: view() }]);
    expect(s.steps).toEqual([expect.objectContaining({ tool: "propose_action", ok: true })]);
  });

  it("maps the flat fields of each kind to its payload", async () => {
    const s = setup();
    await s.call({ kind: "annotation", date: "2026-11-27", annotationTitle: "Black Friday starts", annotationText: "Free shipping over $75", metric: "net_sales", ...common });
    await s.call({ kind: "discount_deactivate", code: "VIPGLOW25", metric: "discounts", ...common });
    expect(s.propose.mock.calls[0]![2]).toMatchObject({ kind: "annotation", payload: { date: "2026-11-27", title: "Black Friday starts", text: "Free shipping over $75" } });
    expect(s.propose.mock.calls[1]![2]).toMatchObject({ kind: "discount_deactivate", metric: "discounts", payload: { code: "VIPGLOW25" } });
  });

  it("proposes a customer segment from a segment id and a name, and has no field for a Shopify query", async () => {
    const s = setup();
    const segment = { kind: "segment_create", segment: "at_risk", segmentName: "At risk (Oasis)", metric: "returning_customer_rate", ...common };
    expect(await s.call(segment)).toEqual({ proposed: true, actionId: view().id, needsApproval: true });
    expect(s.propose.mock.calls[0]![2]).toMatchObject({ kind: "segment_create", metric: "returning_customer_rate", payload: { segment: "at_risk", name: "At risk (Oasis)" } });
    for (const bad of [
      { ...segment, query: "number_of_orders > 0" }, // a query is refused, never passed on
      { ...segment, segment: "whales" },
      { ...segment, segmentName: 'x" } { drop' },
      { ...segment, segment: undefined },
      { ...segment, code: "VIPGLOW25" },
    ]) {
      expect(await s.call(bad), JSON.stringify(bad)).toMatchObject({ error: { code: "INVALID_INPUT" } });
    }
    expect(s.propose).toHaveBeenCalledTimes(1);
    const flat = z.toJSONSchema(proposeActionInput) as unknown as { properties: Record<string, unknown> };
    expect(Object.keys(flat.properties).filter((k) => /query/i.test(k))).toEqual([]);
  });

  it("never runs an executor or reaches Shopify", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const runs = [metricTargetExecutor, annotationExecutor, discountDeactivateExecutor, segmentCreateExecutor].map((e) => vi.spyOn(e, "run"));
    const s = setup();
    await s.call(target);
    await s.call({ kind: "segment_create", segment: "champions", segmentName: "Champions", metric: "returning_customer_rate", ...common });
    expect(s.propose).toHaveBeenCalledTimes(2);
    expect(fetchSpy).not.toHaveBeenCalled();
    for (const r of runs) expect(r).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("sends a bad proposal back to the model and proposes nothing", async () => {
    const s = setup();
    for (const bad of [
      { ...target, code: "VIPGLOW25" }, // a field of another kind
      { ...target, month: "2026-13" },
      { ...target, metric: "aov" },
      { kind: "discount_deactivate", code: "vipglow25", metric: "discounts", ...common },
      { kind: "annotation", date: "2026-11-27", annotationTitle: "x".repeat(76), annotationText: "ok", metric: "net_sales", ...common },
      { kind: "annotation", metric: "net_sales", ...common },
    ]) {
      expect(await s.call(bad), JSON.stringify(bad)).toMatchObject({ error: { code: "INVALID_INPUT" } });
    }
    expect(s.propose).not.toHaveBeenCalled();
    expect(s.written).toEqual([]);
  });

  it("returns the ledger's INVALID_INPUT to the model and rethrows anything else", async () => {
    const invalid = setup(async () => { throw new AppError("INVALID_INPUT", "checkOn must be 2026-11-02 or later."); });
    expect(await invalid.call(target)).toEqual({ error: { code: "INVALID_INPUT", message: "checkOn must be 2026-11-02 or later." } });
    expect(invalid.steps[0]).toMatchObject({ ok: false, errorCode: "INVALID_INPUT" });
    expect(invalid.written).toEqual([]);

    const broken = setup(async () => { throw new Error("db down"); });
    await expect(broken.call(target)).rejects.toThrow("db down");
  });

  it("allows three proposals in one answer, not four", async () => {
    const s = setup();
    for (let i = 0; i < 3; i++) expect(await s.call(target)).toMatchObject({ proposed: true });
    expect(await s.call(target)).toMatchObject({ error: { code: "INVALID_INPUT" } });
    expect(s.propose).toHaveBeenCalledTimes(3);
  });

  it("has no tenant, shop, organisation or user field anywhere in its input", () => {
    const forbidden = /tenant|shop|org|user|account|owner/i;
    const flat = z.toJSONSchema(proposeActionInput) as unknown as { type: string; additionalProperties: boolean; properties: Record<string, unknown> };
    expect(flat.type).toBe("object"); // a union at the top of a tool schema is refused by Anthropic
    expect(flat.additionalProperties).toBe(false);
    expect(Object.keys(flat.properties).filter((k) => forbidden.test(k))).toEqual([]);
    for (const option of proposeActionUnion.options) {
      expect(Object.keys(option.shape).filter((k) => forbidden.test(k))).toEqual([]);
      expect(Object.keys(option.shape).every((k) => k in flat.properties)).toBe(true);
    }
  });
});
