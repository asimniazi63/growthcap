"use client";

import { useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { BUNDLE_THIN_ORDERS, type BundlePair, type ViewData } from "@/lib/views/types";
import { liftFill, SCALE_FILLS, THIN_LINES } from "./bundle-shading";
import { CaveatsNote } from "./caveats-note";
import { NumbersTable } from "./numbers-table";

type Data = Extract<ViewData, { component: "bundle_matrix" }>;

// A heat matrix of the products that were bought together: a cell for each pair, shaded by lift (neutral at 1.0, one hue above
// it, a capped strength), with the orders that held both printed in it. A pair under BUNDLE_THIN_ORDERS orders is hatched. The
// matrix is mirrored, but only the lower half takes the keyboard (arrow keys move between pairs). Hover, focus or a tap shows
// the pair's figures in the card below. Product titles are store text and are only ever rendered as text.

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const lift2 = (x: number) => x.toFixed(2);
const key = (r: number, c: number) => `${r}-${c}`;

export function BundleMatrix({ data, defaultActive }: { data: Data; defaultActive?: [number, number] }) {
  const { products, pairs } = data;
  const cells = useRef(new Map<string, HTMLButtonElement>());
  const byCell = new Map<string, BundlePair>(pairs.map((p) => [key(p.b, p.a), p])); // lower half: row b, column a
  const [active, setActive] = useState<BundlePair | null>(() => (defaultActive ? (byCell.get(key(Math.max(...defaultActive), Math.min(...defaultActive))) ?? null) : null));
  // The one cell in the tab order: where focus last was, else the first pair.
  const firstPair = pairs.length > 0 ? [...byCell.keys()].sort((x, y) => Number(x.split("-")[0]) - Number(y.split("-")[0]) || Number(x.split("-")[1]) - Number(y.split("-")[1]))[0] : undefined;
  const [tab, setTab] = useState<string | undefined>(undefined);
  const tabbable = tab ?? (defaultActive ? key(Math.max(...defaultActive), Math.min(...defaultActive)) : firstPair);

  if (pairs.length === 0) {
    return (
      <>
        <p className="muted text-sm">No pair of products appeared together often enough to draw.</p>
        <CaveatsNote items={data.caveats} />
      </>
    );
  }

  const n = products.length;
  const lifts = pairs.map((p) => p.lift);
  const lo = Math.min(...lifts);
  const hi = Math.max(...lifts);
  const thinCount = pairs.filter((p) => p.thin).length;

  const describe = (p: BundlePair) => {
    const A = products[p.a]!.title;
    const B = products[p.b]!.title;
    return `${A} and ${B}: ${p.ordersTogether} orders together${p.thin ? ", a thin signal" : ""}. ${pct(p.confidenceAtoB)} of orders with ${A} also had ${B}. ${pct(p.confidenceBtoA)} of orders with ${B} also had ${A}. Lift ${lift2(p.lift)}`;
  };

  // Arrow keys step to the next pair in that direction, skipping cells with no pair.
  function move(e: KeyboardEvent, r: number, c: number) {
    const step = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
    if (!step) return;
    e.preventDefault();
    for (let rr = r + step[0]!, cc = c + step[1]!; rr >= 0 && rr < n && cc >= 0 && cc < rr; rr += step[0]!, cc += step[1]!) {
      const next = cells.current.get(key(rr, cc));
      if (next) return next.focus();
    }
  }

  const paint = (p: BundlePair): CSSProperties => ({ background: p.thin ? `${THIN_LINES}, ${liftFill(p.lift)}` : liftFill(p.lift) });
  const label = `Products bought together: ${n} products and ${pairs.length} pairs, lifts from ${lift2(lo)} to ${lift2(hi)}. Each cell is a pair; the number is the orders that held both.`;

  return (
    <>
      <div className="overflow-x-auto pb-1">
        <div role="group" aria-label={label} className="grid min-w-max gap-1 [--head:7rem] sm:[--head:10.5rem]" style={{ gridTemplateColumns: `var(--head) repeat(${n}, minmax(2.5rem, 1fr))`, minWidth: `calc(var(--head) + ${n * 2.75}rem)` }}>
          <div aria-hidden />
          {products.map((p, c) => (
            <div key={c} aria-hidden className="flex justify-center pb-1">
              <Chip n={c + 1} on={active?.a === c || active?.b === c} title={p.title} />
            </div>
          ))}
          {products.flatMap((p, r) => [
            <div key={`h${r}`} aria-hidden className="sticky left-0 z-[1] flex items-center gap-2 bg-surface pr-2">
              <Chip n={r + 1} on={active?.a === r || active?.b === r} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium leading-tight" title={p.title}>{p.title}</span>
                <span className="muted num block text-[11px] leading-tight">{`${p.orders} orders`}</span>
              </span>
            </div>,
            ...products.map((_, c) => {
              if (c === r) return <div key={key(r, c)} aria-hidden className="flex items-center justify-center text-[11px] font-medium text-ink-3">{r + 1}</div>;
              const pair = byCell.get(key(Math.max(r, c), Math.min(r, c)));
              if (!pair) return <div key={key(r, c)} aria-hidden className="min-h-10 rounded-md bg-paper" />;
              const on = active === pair;
              const face = `num flex min-h-10 w-full items-center justify-center rounded-md border border-line-strong text-[13px] font-semibold text-ink ${on ? "ring-2 ring-ink" : ""}`;
              // The upper half repeats the lower: it answers the mouse but is not a second stop for the keyboard or a screen reader.
              if (c > r) {
                return (
                  <div key={key(r, c)} aria-hidden className={face} style={paint(pair)} onMouseEnter={() => setActive(pair)}>
                    {pair.ordersTogether}
                  </div>
                );
              }
              return (
                <button
                  key={key(r, c)}
                  ref={(el) => {
                    if (el) cells.current.set(key(r, c), el);
                    else cells.current.delete(key(r, c));
                  }}
                  type="button"
                  aria-label={describe(pair)}
                  aria-pressed={on}
                  tabIndex={tabbable === key(r, c) ? 0 : -1}
                  className={`${face} cursor-pointer focus-visible:z-10`}
                  style={paint(pair)}
                  onMouseEnter={() => setActive(pair)}
                  onFocus={() => {
                    setActive(pair);
                    setTab(key(r, c));
                  }}
                  onClick={() => setActive(pair)}
                  onKeyDown={(e) => move(e, r, c)}
                >
                  {pair.ordersTogether}
                </button>
              );
            }),
          ])}
        </div>
      </div>

      <div className="inset mt-3 p-3.5 text-sm">
        {active ? (
          <>
            <p className="font-medium">
              {products[active.a]!.title} <span className="muted font-normal">and</span> {products[active.b]!.title}
            </p>
            <dl className="mt-2 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
              <div>
                <dt className="muted text-[12px]">Orders together</dt>
                <dd className="num">
                  <span className="font-semibold">{active.ordersTogether}</span>
                  {active.thin ? <span className="badge badge-warn ml-2">{`Thin signal: under ${BUNDLE_THIN_ORDERS} orders`}</span> : null}
                </dd>
              </div>
              <div>
                <dt className="muted text-[12px]">Lift</dt>
                <dd className="num">
                  <span className="font-semibold">{lift2(active.lift)}</span>
                  <span className="muted">{` times as often as chance`}</span>
                </dd>
              </div>
              <div>
                <dt className="muted text-[12px]">Starting from the first product</dt>
                <dd className="num">{`${pct(active.confidenceAtoB)} of orders with ${products[active.a]!.title} also had ${products[active.b]!.title}`}</dd>
              </div>
              <div>
                <dt className="muted text-[12px]">Starting from the second product</dt>
                <dd className="num">{`${pct(active.confidenceBtoA)} of orders with ${products[active.b]!.title} also had ${products[active.a]!.title}`}</dd>
              </div>
            </dl>
          </>
        ) : (
          <p className="muted">Hover over a cell, tap it, or move to it with the arrow keys to see the pair.</p>
        )}
      </div>

      <div className="mt-3 text-[12px]">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <span className="font-medium">Lift</span>
          <span className="inline-flex items-center gap-2">
            <span aria-hidden className="inline-block h-3 w-24 rounded-sm border border-line-strong" style={{ background: `linear-gradient(90deg, ${SCALE_FILLS.low} 0%, ${SCALE_FILLS.mid} 33.3%, ${SCALE_FILLS.high} 100%)` }} />
            <span className="muted">0.5 or less, 1.0 (as often as chance), 2.0 or more</span>
          </span>
          <span className="inline-flex items-center gap-2">
            <span aria-hidden className="inline-block h-3 w-6 rounded-sm border border-line-strong" style={{ background: `${THIN_LINES}, ${SCALE_FILLS.mid}` }} />
            <span className="muted">{`Hatched: under ${BUNDLE_THIN_ORDERS} orders together, a thin signal`}</span>
          </span>
        </div>
        <p className="muted mt-2 text-[13px]">
          {`The number in a cell is how many orders held both products. Products are ordered by how many orders they share with the others listed. Among the pairs drawn, lifts run from ${lift2(lo)} to ${lift2(hi)}; the shading stops getting stronger at 2.0, so a weak link is never made to look strong.${thinCount > 0 ? ` ${thinCount} of ${pairs.length} pairs are thin.` : ""} This is what was bought together, not proof that a bundle would sell.`}
          {data.omitted ? ` The ${n} products that share the most orders are drawn; ${data.omitted.pairs} other ${data.omitted.pairs === 1 ? "pair is" : "pairs are"} not.` : ""}
          {data.truncated ? ` The tool listed ${data.truncated.shown} of ${data.truncated.total} pairs.` : ""}
        </p>
      </div>
      <CaveatsNote items={data.caveats} />

      <NumbersTable
        sections={[
          {
            caption: `Every pair drawn, strongest lift first (${data.ordersInRange} orders in the period)`,
            head: ["Pair", "Orders together", "Orders with the first", "Orders with the second", "First also had second", "Second also had first", "Lift", "Signal"],
            rows: pairs.map((p) => [
              `${products[p.a]!.title} + ${products[p.b]!.title}`,
              String(p.ordersTogether),
              String(products[p.a]!.orders),
              String(products[p.b]!.orders),
              pct(p.confidenceAtoB),
              pct(p.confidenceBtoA),
              lift2(p.lift),
              p.thin ? `Thin (under ${BUNDLE_THIN_ORDERS})` : "",
            ]),
          },
        ]}
      />
    </>
  );
}

function Chip({ n, on, title }: { n: number; on: boolean; title?: string }) {
  return (
    <span title={title} className={`num flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${on ? "bg-inverse text-on-inverse" : "bg-paper-2 text-ink-2"}`}>
      {n}
    </span>
  );
}
