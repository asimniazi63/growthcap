import { PageSkeleton, Skeleton, SkeletonCard } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageSkeleton>
      <div className="space-y-10">
        <SkeletonCard>
          <Skeleton className="h-28 rounded-xl" />
        </SkeletonCard>
        <SkeletonCard lines={2} />
        <div className="space-y-4">
          <Skeleton className="h-6 w-32" />
          <SkeletonCard lines={4} />
        </div>
      </div>
    </PageSkeleton>
  );
}
