import { PageSkeleton, Skeleton, SkeletonCard, SkeletonChart, SkeletonLine, SkeletonRows } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageSkeleton>
      <div className="space-y-4">
        <Skeleton className="h-[58px] rounded-2xl" />
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-4">
            <SkeletonCard>
              <Skeleton className="h-10 w-56 max-w-full" />
              <SkeletonLine className="mt-2 h-3 w-48" />
              <SkeletonChart className="mt-3 h-[190px]" />
            </SkeletonCard>
            <SkeletonCard>
              <SkeletonRows rows={2} />
            </SkeletonCard>
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <SkeletonCard>
              <SkeletonRows rows={3} />
            </SkeletonCard>
            <SkeletonCard lines={4} />
          </div>
        </div>
      </div>
    </PageSkeleton>
  );
}
