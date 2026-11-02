import { PageSkeleton, SkeletonCard } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageSkeleton>
      <div className="space-y-4">
        <SkeletonCard lines={4} />
        <SkeletonCard lines={3} />
      </div>
    </PageSkeleton>
  );
}
