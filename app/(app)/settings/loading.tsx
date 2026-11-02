import { PageSkeleton, Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageSkeleton>
      <div className="flex flex-col gap-9">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(215px,1fr))] gap-4">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-44 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-10 w-72 max-w-full rounded-full" />
      </div>
    </PageSkeleton>
  );
}
