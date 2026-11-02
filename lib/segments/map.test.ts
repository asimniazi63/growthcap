import { describe, expect, it } from "vitest";
import { topCustomers } from "../../components/segments/format";
import { SEGMENT_RULES, type SegmentCustomer } from "./definitions";
import {
  daysTicks,
  DRAW_ORDER,
  edgeMark,
  labelAnchors,
  listedIds,
  ltvTicks,
  makeDaysScale,
  makeFrame,
  makeLtvScale,
  makeScales,
  markPath,
  nearestMark,
  nextInDirection,
  placeMarks,
  ruleGuides,
  segmentTitle,
  SEGMENT_SHAPE,
  toMapPoints,
  type MapPoint,
} from "./map";

const point = (over: Partial<MapPoint> = {}): MapPoint => ({ id: "CUST_a", orders: 2, ltvCents: 15_000, daysSinceLast: 100, churnRisk: 0.3, segment: "at_risk", ...over });

describe("toMapPoints", () => {
  it("keeps only the six fields the map shows", () => {
    const c: SegmentCustomer = {
      customerId: "CUST_x",
      orders: 3,
      firstOrderDate: "2026-01-02",
      lastOrderDate: "2026-09-20",
      daysSinceLast: 41,
      ltvCents: 9_900,
      medianGapDays: 30,
      r: 4,
      f: 4,
      m: 3,
      churnRisk: 0.12,
      segment: "champions",
    };
    expect(toMapPoints([c])).toEqual([{ id: "CUST_x", orders: 3, ltvCents: 9_900, daysSinceLast: 41, churnRisk: 0.12, segment: "champions" }]);
    expect(Object.keys(toMapPoints([c])[0]!).sort()).toEqual(["churnRisk", "daysSinceLast", "id", "ltvCents", "orders", "segment"]);
  });
});

describe("the lifetime value scale", () => {
  // The brand's real shape: most customers between about $70 and $330, one at about $6,760.
  const typical = Array.from({ length: 60 }, (_, i) => 7_000 + i * 550);
  const values = [...typical, 676_000];

  it("puts zero on the baseline and the top of the axis above the biggest customer", () => {
    const s = makeLtvScale(values);
    expect(s.toUnit(0)).toBe(0);
    expect(s.top).toBeGreaterThan(676_000);
    expect(s.toUnit(676_000)).toBeGreaterThan(0.85);
    expect(s.toUnit(676_000)).toBeLessThan(1);
    expect(s.toUnit(s.top)).toBeCloseTo(1, 10);
  });

  it("only ever goes up with the value, and never leaves 0 to 1", () => {
    const s = makeLtvScale(values);
    let last = -1;
    for (const v of [0, 1, 100, 7_000, 20_000, 40_000, 100_000, 676_000, 5_000_000]) {
      const u = s.toUnit(v);
      expect(u).toBeGreaterThanOrEqual(last);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThanOrEqual(1);
      last = u;
    }
  });

  it("does not squash the typical customers when one is thirty times the median", () => {
    const s = makeLtvScale(values);
    const span = s.toUnit(40_000) - s.toUnit(7_000); // about $70 to $400
    expect(span).toBeGreaterThan(0.2); // a straight scale gives about 0.05, a square root about 0.1
    const straight = (40_000 - 7_000) / s.top;
    expect(span).toBeGreaterThan(straight * 4);
  });

  it("is close to straight below the knee, so small differences between small customers still show", () => {
    const s = makeLtvScale(values);
    const low = s.toUnit(s.knee / 10) / (s.knee / 10);
    const lower = s.toUnit(s.knee / 100) / (s.knee / 100);
    expect(low / lower).toBeGreaterThan(0.9);
  });

  it("draws zero and negative lifetime values (a refunded customer) on the baseline instead of failing", () => {
    const s = makeLtvScale([...values, -2_500, 0]);
    expect(s.toUnit(-2_500)).toBe(0);
    expect(s.toUnit(0)).toBe(0);
    expect(s.toUnit(Number.NaN)).toBe(0);
  });

  it("copes with no customers, one customer, and customers who are all the same", () => {
    const none = makeLtvScale([]);
    expect(none.top).toBeGreaterThan(0);
    expect(none.toUnit(0)).toBe(0);
    expect(Number.isFinite(none.toUnit(5_000))).toBe(true);

    const one = makeLtvScale([12_345]);
    expect(one.toUnit(12_345)).toBeGreaterThan(0.5);
    expect(one.toUnit(12_345)).toBeLessThan(1);

    const same = makeLtvScale([9_900, 9_900, 9_900]);
    expect(same.toUnit(9_900)).toBeGreaterThan(0.5);
    expect(same.toUnit(9_900)).toBeLessThan(1);

    const zeros = makeLtvScale([0, 0]);
    expect(zeros.toUnit(0)).toBe(0);
    expect(Number.isFinite(zeros.top)).toBe(true);
  });

  it("does not depend on the order the values arrive in", () => {
    const a = makeLtvScale(values);
    const b = makeLtvScale([...values].reverse());
    expect(a.top).toBe(b.top);
    expect(a.knee).toBe(b.knee);
  });
});

describe("the lifetime value ticks", () => {
  const s = makeLtvScale([...Array.from({ length: 60 }, (_, i) => 7_000 + i * 550), 676_000]);

  it("start at zero and are round dollar values (1, 2 or 5 times a power of ten), never above the top of the axis", () => {
    const ticks = ltvTicks(s, 320);
    expect(ticks[0]).toBe(0);
    for (const t of ticks.slice(1)) {
      expect(t).toBeLessThanOrEqual(s.top);
      expect(t % 100).toBe(0); // whole dollars
      const dollars = t / 100;
      expect([1, 2, 5]).toContain(Number((dollars / 10 ** Math.floor(Math.log10(dollars))).toFixed(6)));
    }
    expect([...ticks]).toEqual([...ticks].sort((a, b) => a - b));
    expect(ticks.at(-1)).toBeGreaterThanOrEqual(500_000); // reaches up to the $5,000 customers
  });

  it("keep at least the minimum gap in pixels, so the labels never overlap", () => {
    for (const h of [200, 320, 500]) {
      const ticks = ltvTicks(s, h, 26);
      for (let i = 1; i < ticks.length; i++) expect((s.toUnit(ticks[i]!) - s.toUnit(ticks[i - 1]!)) * h).toBeGreaterThanOrEqual(26);
    }
  });

  it("thin out when the chart is short and fill in when it is tall", () => {
    expect(ltvTicks(s, 160).length).toBeLessThan(ltvTicks(s, 480).length);
  });

  it("is only the baseline for an empty chart with no room", () => {
    expect(ltvTicks(makeLtvScale([]), 0)).toEqual([0]);
  });
});

describe("the days scale", () => {
  it("puts zero at the left and the oldest customer's day count at the right, rounded up to a whole 30 days", () => {
    const s = makeDaysScale([0, 12, 640, 812]);
    expect(s.top).toBe(840);
    expect(s.toUnit(0)).toBe(0);
    expect(s.toUnit(840)).toBe(1);
    expect(s.toUnit(2_000)).toBe(1);
    expect(s.toUnit(-5)).toBe(0);
  });

  it("stretches the recent end: a square root, so the first 90 days get more than their share of the width", () => {
    const s = makeDaysScale([0, 840]);
    expect(s.toUnit(90)).toBeGreaterThan(90 / 840 + 0.15);
    expect(s.toUnit(210)).toBeCloseTo(0.5, 6);
  });

  it("copes with no customers, one customer, and everyone ordering on the last day", () => {
    expect(makeDaysScale([]).top).toBe(30);
    expect(makeDaysScale([0, 0]).top).toBe(30);
    expect(makeDaysScale([45]).top).toBe(60);
    expect(makeDaysScale([45]).toUnit(45)).toBeCloseTo(Math.sqrt(0.75), 6);
    expect(makeDaysScale([Number.NaN]).top).toBe(30);
  });
});

describe("the segment rule guides", () => {
  it("are read from SEGMENT_RULES: one and done starts, champions end, at risk ends", () => {
    const g = ruleGuides();
    expect(g.map((x) => x.days)).toEqual([SEGMENT_RULES.oneAndDone.minDaysSinceLast, SEGMENT_RULES.champions.maxDaysSinceLast, SEGMENT_RULES.atRisk.maxDaysSinceLast]);
    expect(g.map((x) => x.days)).toEqual([60, 90, 365]); // today's rules
    expect(g[0]!.note).toBe("60 days (one and done starts)");
  });

  it("follow the rules when the rules change, and drop a day two rules share", () => {
    const changed = { ...SEGMENT_RULES, oneAndDone: { minDaysSinceLast: 45 }, atRisk: { maxDaysSinceLast: 180 } };
    expect(ruleGuides(changed).map((x) => x.days)).toEqual([45, 90, 180]);
    const shared = { ...SEGMENT_RULES, oneAndDone: { minDaysSinceLast: 90 } };
    expect(ruleGuides(shared).map((x) => x.days)).toEqual([90, 365]);
  });
});

describe("the days ticks", () => {
  const s = makeDaysScale([0, 812]);

  it("always include the start and every rule day that fits, and never a tick beyond the right edge", () => {
    const ticks = daysTicks(s, [60, 90, 365], 600);
    expect(ticks).toContain(0);
    for (const d of [60, 90, 365]) expect(ticks).toContain(d);
    expect(Math.max(...ticks)).toBeLessThanOrEqual(s.top);
    expect(new Set(ticks).size).toBe(ticks.length);
  });

  it("leaves out a rule day that is past the right edge", () => {
    const recent = makeDaysScale([0, 150]);
    expect(daysTicks(recent, [60, 90, 365], 600)).not.toContain(365);
  });

  it("adds the round steps only where they do not crowd a rule day or each other", () => {
    const ticks = daysTicks(s, [60, 90, 365], 600, 34);
    for (let i = 1; i < ticks.length; i++) {
      const gap = (s.toUnit(ticks[i]!) - s.toUnit(ticks[i - 1]!)) * 600;
      const bothRules = [ticks[i], ticks[i - 1]].every((t) => t === 0 || [60, 90, 365].includes(t!));
      if (!bothRules) expect(gap).toBeGreaterThanOrEqual(34);
    }
  });
});

describe("labelAnchors", () => {
  it("centres labels that have room, and parts two that would collide: the left ends at its tick, the right starts at its", () => {
    expect(labelAnchors([10, 80, 160], 22)).toEqual(["middle", "middle", "middle"]);
    expect(labelAnchors([10, 80, 94, 160], 22)).toEqual(["middle", "end", "start", "middle"]);
  });

  it("leaves a label in the middle when it is crowded on both sides, and copes with none or one", () => {
    expect(labelAnchors([10, 20, 30], 22)[1]).toBe("middle");
    expect(labelAnchors([], 22)).toEqual([]);
    expect(labelAnchors([5], 22)).toEqual(["middle"]);
  });
});

describe("markPath", () => {
  it("gives every segment its own shape, five different ones", () => {
    expect(new Set(Object.values(SEGMENT_SHAPE)).size).toBe(5);
    const paths = (Object.keys(SEGMENT_SHAPE) as (keyof typeof SEGMENT_SHAPE)[]).map((s) => markPath(SEGMENT_SHAPE[s], 10, 10, 3.5));
    expect(new Set(paths).size).toBe(5);
  });

  // The area of a closed path of straight "M x y L x y L x y ..." edges, by the shoelace formula.
  const area = (d: string) => {
    const pts = [...d.matchAll(/[ML]\s*(-?[\d.]+)\s+(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
    return Math.abs(pts.reduce((sum, [x, y], i) => sum + (x * pts[(i + 1) % pts.length]![1] - pts[(i + 1) % pts.length]![0] * y), 0)) / 2;
  };

  it("sizes the shapes to cover about the same area as the circle, so no segment looks bigger than another", () => {
    const circle = Math.PI * 3.5 ** 2;
    expect(area(markPath("diamond", 10, 20, 3.5))).toBeCloseTo(circle, 0);
    expect(area(markPath("triangle", 10, 20, 3.5))).toBeCloseTo(circle, 0);
    const side = Number(/h(-?[\d.]+)v/.exec(markPath("square", 10, 20, 3.5))![1]);
    expect(side * side).toBeCloseTo(circle, 0);
  });

  it("centres the mark on the point", () => {
    expect(markPath("diamond", 10, 20, 4)).toBe("M10 14.99L15.01 20L10 25.01L4.99 20Z");
    expect(markPath("cross", 5, 5, 4)).toBe("M0.4 5h9.2M5 0.4v9.2");
    expect(markPath("circle", 10, 20, 4)).toBe("M6 20a4 4 0 1 0 8 0a4 4 0 1 0 -8 0Z");
    expect(markPath("square", 10, 20, 3.5)).toMatch(/^M6\.9\d? 16\.9\d?h/);
  });
});

describe("placeMarks and makeFrame", () => {
  const pts = [
    point({ id: "CUST_1", segment: "champions", daysSinceLast: 5, ltvCents: 90_000 }),
    point({ id: "CUST_2", segment: "active", daysSinceLast: 30, ltvCents: 2_000 }),
    point({ id: "CUST_3", segment: "one_and_done", daysSinceLast: 400, ltvCents: 8_000 }),
    point({ id: "CUST_4", segment: "at_risk", daysSinceLast: 200, ltvCents: 30_000 }),
  ];
  const frame = makeFrame(makeScales(pts), { width: 700, height: 400 }, { left: 56, top: 26, right: 14, bottom: 50 });

  it("keeps every mark inside the plot, whole, even at the baseline and the top", () => {
    const all = [...pts, point({ id: "CUST_0", ltvCents: 0, daysSinceLast: 0 }), point({ id: "CUST_9", ltvCents: 1e9, daysSinceLast: 9_999 })];
    const f = makeFrame(makeScales(all), { width: 700, height: 400 }, { left: 56, top: 26, right: 14, bottom: 50 });
    for (const m of placeMarks(all, f)) {
      expect(m.x).toBeGreaterThanOrEqual(f.left + 3.5);
      expect(m.x).toBeLessThanOrEqual(f.right - 3.5);
      expect(m.y).toBeGreaterThanOrEqual(f.top + 3.5);
      expect(m.y).toBeLessThanOrEqual(f.bottom - 3.5);
    }
  });

  it("puts a more recent customer further left and a bigger customer further up", () => {
    const [a, b] = [frame.x(5), frame.x(400)];
    expect(a).toBeLessThan(b);
    expect(frame.y(90_000)).toBeLessThan(frame.y(2_000));
  });

  it("draws the muted majority first and the segments to act on last, whatever order the data came in", () => {
    const marks = placeMarks([...pts].reverse(), frame);
    expect(marks.map((m) => m.segment)).toEqual(DRAW_ORDER.filter((s) => pts.some((p) => p.segment === s)));
    expect(placeMarks(pts, frame)).toEqual(marks);
  });

  it("is the same marks for the same input", () => {
    expect(placeMarks(pts, frame)).toEqual(placeMarks(pts, frame));
  });
});

describe("nearestMark", () => {
  const marks = [
    { id: "a", x: 10, y: 10 },
    { id: "b", x: 40, y: 10 },
    { id: "c", x: 40, y: 12 },
  ];

  it("returns the closest dot, only if it is within the reach", () => {
    expect(nearestMark(marks, 12, 11, 16)?.id).toBe("a");
    expect(nearestMark(marks, 39, 13, 16)?.id).toBe("c");
    expect(nearestMark(marks, 200, 200, 16)).toBeNull();
    expect(nearestMark(marks, 200, 200)?.id).toBe("c"); // no reach given: simply the closest
    expect(nearestMark([], 0, 0, 16)).toBeNull();
  });

  it("settles a tie by id, so the same spot always answers the same", () => {
    const tie = [
      { id: "z", x: 5, y: 5 },
      { id: "m", x: 5, y: 5 },
    ];
    expect(nearestMark(tie, 5, 5, 10)?.id).toBe("m");
  });
});

describe("nextInDirection: the arrow keys", () => {
  const grid = [
    { id: "a", x: 10, y: 10 },
    { id: "b", x: 50, y: 12 },
    { id: "c", x: 90, y: 10 },
    { id: "d", x: 52, y: 60 },
    { id: "e", x: 300, y: 300 },
  ];

  it("goes to the nearest dot that way, preferring the same row or column", () => {
    expect(nextInDirection(grid, "a", "right")?.id).toBe("b");
    expect(nextInDirection(grid, "b", "right")?.id).toBe("c");
    expect(nextInDirection(grid, "c", "left")?.id).toBe("b");
    expect(nextInDirection(grid, "b", "down")?.id).toBe("d");
    expect(nextInDirection(grid, "d", "up")?.id).toBe("b");
  });

  it("stays put (null) at an edge, and for a dot that is not there", () => {
    expect(nextInDirection(grid, "a", "left")).toBeNull();
    expect(nextInDirection(grid, "a", "up")).toBeNull();
    expect(nextInDirection(grid, "e", "right")).toBeNull();
    expect(nextInDirection(grid, "nope", "right")).toBeNull();
  });

  it("reaches every dot from any other, so the keys never strand a customer", () => {
    const seen = new Set<string>(["a"]);
    const queue = ["a"];
    while (queue.length) {
      const from = queue.shift()!;
      for (const dir of ["left", "right", "up", "down"] as const) {
        const next = nextInDirection(grid, from, dir);
        if (next && !seen.has(next.id)) {
          seen.add(next.id);
          queue.push(next.id);
        }
      }
    }
    expect(seen.size).toBe(grid.length);
  });

  it("steps through customers drawn on exactly the same spot: right and down forward in id order, left and up back", () => {
    const stack = [
      { id: "p", x: 100, y: 100 },
      { id: "q", x: 100, y: 100 },
      { id: "r", x: 100, y: 100 },
      { id: "far", x: 400, y: 100 },
    ];
    expect(nextInDirection(stack, "p", "right")?.id).toBe("q");
    expect(nextInDirection(stack, "q", "right")?.id).toBe("r");
    expect(nextInDirection(stack, "r", "right")?.id).toBe("far"); // the last of the pile moves on
    expect(nextInDirection(stack, "r", "left")?.id).toBe("q");
    expect(nextInDirection(stack, "q", "up")?.id).toBe("p");
    expect(nextInDirection(stack, "p", "down")?.id).toBe("q");
  });
});

describe("edgeMark: Home and End", () => {
  const marks = [
    { id: "b", x: 50, y: 1 },
    { id: "a", x: 50, y: 2 },
    { id: "c", x: 90, y: 1 },
  ];
  it("finds the most recent (left) and the longest ago (right), the lower id on a tie", () => {
    expect(edgeMark(marks, "left")?.id).toBe("a");
    expect(edgeMark(marks, "right")?.id).toBe("c");
    expect(edgeMark([], "left")).toBeNull();
  });
});

describe("listedIds: the customers in the Top customers table", () => {
  it("matches the table's own order and cut", () => {
    const customers: SegmentCustomer[] = Array.from({ length: 30 }, (_, i) => ({
      customerId: `CUST_${String(i % 10).padStart(2, "0")}${i}`,
      orders: 3,
      firstOrderDate: "2026-01-01",
      lastOrderDate: "2026-09-01",
      daysSinceLast: 40,
      ltvCents: (i % 7) * 1_000, // plenty of ties on value
      medianGapDays: 30,
      r: 3,
      f: 3,
      m: 3,
      churnRisk: 0.1,
      segment: i % 3 === 0 ? "champions" : "at_risk",
    }));
    for (const segment of ["champions", "at_risk"] as const) {
      const expected = topCustomers(customers, segment, 15).map((c) => c.customerId);
      expect([...listedIds(toMapPoints(customers), segment, 15)].sort()).toEqual([...expected].sort());
    }
  });

  it("is empty for a segment nobody is in", () => {
    expect(listedIds([point()], "champions", 15).size).toBe(0);
  });
});

describe("segmentTitle", () => {
  it("names the four segments from the definitions and the rest Active", () => {
    expect(segmentTitle("at_risk")).toBe("At risk");
    expect(segmentTitle("one_and_done")).toBe("One and done");
    expect(segmentTitle("active")).toBe("Active");
  });
});
