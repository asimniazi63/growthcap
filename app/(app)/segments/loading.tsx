import { PageSkeleton, Skeleton, SkeletonCard, SkeletonLine, SkeletonTable } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageSkeleton actions>
      <SkeletonLine className="mb-4 w-2/3" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <SkeletonCard key={i}>
            <Skeleton className="h-9 w-24" />
            <SkeletonLine className="mt-3 w-full" />
            <SkeletonLine className="mt-2 w-2/3" />
          </SkeletonCard>
        ))}
      </div>
      <Skeleton className="mb-4 mt-10 h-6 w-48" />
      <div className="card card-pad" aria-hidden>
        <Skeleton className="h-64" />
      </div>
      <Skeleton className="mb-4 mt-10 h-6 w-40" />
      <SkeletonTable rows={5} cols={5} />
    </PageSkeleton>
  );
}
