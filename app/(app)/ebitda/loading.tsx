import { PageSkeleton, Skeleton, SkeletonCard, SkeletonChart, SkeletonTable } from "@/components/ui/skeleton";

// The shape of the EBITDA page while it loads: the month table, the chart for one month, the receipts, the what-if panel and the cost sheet.
export default function Loading() {
  return (
    <PageSkeleton>
      <Skeleton className="mb-4 h-6 w-36" />
      <SkeletonTable rows={6} cols={6} />
      <Skeleton className="mb-4 mt-10 h-6 w-52" />
      <div className="card card-pad" aria-hidden>
        <SkeletonChart className="h-72" />
      </div>
      <Skeleton className="mb-4 mt-10 h-6 w-56" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <SkeletonCard key={i} lines={2} />
        ))}
      </div>
      <Skeleton className="mb-4 mt-10 h-6 w-28" />
      <SkeletonCard lines={4} />
      <Skeleton className="mb-4 mt-10 h-6 w-32" />
      <SkeletonTable rows={5} cols={7} minWidth={640} />
    </PageSkeleton>
  );
}
