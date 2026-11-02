import { PageSkeleton, SkeletonCard, SkeletonRows } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageSkeleton>
      <div className="space-y-4">
        {[0, 1, 2].map((i) => (
          <SkeletonCard key={i}>
            <SkeletonRows rows={1} />
          </SkeletonCard>
        ))}
      </div>
    </PageSkeleton>
  );
}
