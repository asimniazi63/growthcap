import { PageSkeleton, Skeleton, SkeletonCard, SkeletonLine } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageSkeleton actions>
      <div className="space-y-8">
        <SkeletonCard lines={2} />
        {[0, 1, 2].map((i) => (
          <SkeletonCard key={i}>
            <Skeleton className="mb-3 h-1.5 w-full rounded-full" />
            <SkeletonLine className="w-5/6" />
            <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
              {[0, 1, 2].map((j) => (
                <Skeleton key={j} className="h-10" />
              ))}
            </div>
          </SkeletonCard>
        ))}
      </div>
    </PageSkeleton>
  );
}
