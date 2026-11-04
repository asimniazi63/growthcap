import { PageSkeleton, SkeletonCard, SkeletonTable } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageSkeleton>
      <div className="space-y-8">
        <div aria-hidden className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
          {Array.from({ length: 4 }, (_, i) => (
            <SkeletonCard key={i} lines={1} />
          ))}
        </div>
        <SkeletonTable rows={4} cols={2} minWidth={420} />
      </div>
    </PageSkeleton>
  );
}
