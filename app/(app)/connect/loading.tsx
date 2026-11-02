import { PageSkeleton, SkeletonCard } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageSkeleton actions>
      <div className="space-y-4">
        <SkeletonCard lines={2} />
        <div className="grid gap-4 md:grid-cols-2">
          <SkeletonCard />
          <SkeletonCard />
        </div>
        <SkeletonCard lines={4} />
      </div>
    </PageSkeleton>
  );
}
