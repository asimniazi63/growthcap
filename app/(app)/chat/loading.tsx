import { PageSkeleton, Skeleton, SkeletonLine } from "@/components/ui/skeleton";

// The chat screen: a title line, a short thread (a question, then an answer) and the input bar at the foot.
export default function Loading() {
  return (
    // data-wide-page lifts the page width cap, as on the chat itself, so the page does not jump when the chat arrives.
    <div data-wide-page>
      <PageSkeleton header={false} className="flex min-h-0 flex-col lg:h-[calc(100dvh-5rem-var(--topbar-h,0px))]" bodyClassName="flex min-h-0 flex-1 flex-col gap-4">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
          <Skeleton className="h-8 w-24" />
          <SkeletonLine className="w-80 max-w-full" />
        </div>
        <div className="card flex min-h-[22rem] flex-1 flex-col gap-5 p-5">
          <Skeleton className="ml-auto h-11 w-3/5 max-w-sm rounded-2xl" />
          <div className="max-w-xl space-y-2.5">
            <SkeletonLine />
            <SkeletonLine className="w-11/12" />
            <SkeletonLine className="w-2/3" />
          </div>
          <Skeleton className="ml-auto h-11 w-2/5 max-w-xs rounded-2xl" />
          <div className="max-w-xl space-y-2.5">
            <SkeletonLine className="w-5/6" />
            <SkeletonLine className="w-1/2" />
          </div>
          <Skeleton className="mt-auto h-[52px] rounded-2xl" />
        </div>
      </PageSkeleton>
    </div>
  );
}
