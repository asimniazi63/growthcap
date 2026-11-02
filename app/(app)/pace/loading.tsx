import { PageSkeleton, Skeleton, SkeletonCard, SkeletonChart, SkeletonLine, SkeletonTable } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageSkeleton>
      <div className="space-y-10">
        <div className="space-y-4">
          <Skeleton className="h-6 w-44" />
          <div className="card p-5 sm:p-7" aria-hidden>
            <div className="grid gap-6 xl:grid-cols-[16rem_minmax(0,1fr)] xl:gap-10">
              <div className="space-y-3">
                <SkeletonLine className="w-32" />
                <Skeleton className="h-12 w-48 max-w-full" />
                <SkeletonLine className="w-40" />
              </div>
              <SkeletonChart className="h-[300px]" />
            </div>
          </div>
          <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <SkeletonCard key={i} lines={2} />
            ))}
          </div>
        </div>
        <div className="space-y-4">
          <Skeleton className="h-6 w-40" />
          <SkeletonTable rows={5} cols={4} />
        </div>
      </div>
    </PageSkeleton>
  );
}
