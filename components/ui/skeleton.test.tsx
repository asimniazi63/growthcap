import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PageSkeleton, Skeleton, SkeletonCard, SkeletonChart, SkeletonLine, SkeletonRows, SkeletonTable } from "./skeleton";

describe("the skeleton set", () => {
  it("PageSkeleton marks the page busy once, says Loading to assistive tech, and hides the grey blocks from it", () => {
    const out = renderToStaticMarkup(
      <PageSkeleton actions>
        <SkeletonCard />
      </PageSkeleton>,
    );
    expect(out).toContain('role="status"');
    expect(out).toContain('aria-busy="true"');
    expect(out).toContain('<span class="sr-only">Loading</span>');
    expect(out.match(/Loading/g)).toHaveLength(1);
    // Every grey block is inside something hidden from assistive tech.
    expect(out.match(/class="skeleton /g)!.length).toBeGreaterThan(3);
    expect(out.match(/aria-hidden="true"/g)!.length).toBeGreaterThan(3);
  });

  it("can leave out the title block, for a page with its own layout", () => {
    const out = renderToStaticMarkup(<PageSkeleton header={false} className="x-outer" bodyClassName="x-body" />);
    expect(out).toContain("x-outer");
    expect(out).toContain("x-body");
    expect(out).not.toContain("h-[34px]");
  });

  it("builds a block, a line, a chart area, a card, rows and a table from the skeleton class and tokens only", () => {
    const out = renderToStaticMarkup(
      <>
        <Skeleton className="h-3 w-3" />
        <SkeletonLine />
        <SkeletonChart />
        <SkeletonCard lines={4} />
        <SkeletonRows rows={2} />
        <SkeletonTable rows={2} cols={3} />
      </>,
    );
    expect(out).toContain("h-48");
    expect(out.match(/class="skeleton h-4/g)!.length).toBeGreaterThanOrEqual(5);
    expect(out).toContain("card card-pad");
    expect(out).toContain("divide-line");
    expect(out).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|animate-spin|spinner/i);
  });
});
