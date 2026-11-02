import { PageSkeleton, Skeleton, SkeletonLine } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageSkeleton>
      <div className="space-y-6">
        {[0, 1, 2].map((i) => (
          <div key={i} className="card overflow-hidden" aria-hidden>
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-5 w-48 max-w-full" />
                <SkeletonLine className="w-96 max-w-full" />
              </div>
              <Skeleton className="h-10 w-28 rounded-[10px]" />
            </div>
            <div className="space-y-3 px-5 py-5 sm:px-6">
              <SkeletonLine />
              <SkeletonLine className="w-5/6" />
            </div>
          </div>
        ))}
      </div>
    </PageSkeleton>
  );
}
