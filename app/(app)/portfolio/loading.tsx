import { PageSkeleton, SkeletonTable } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageSkeleton>
      <SkeletonTable rows={4} cols={5} minWidth={900} />
    </PageSkeleton>
  );
}
