import { PageSkeleton, SkeletonCard } from "@/components/ui/skeleton";

// The fallback for any page without its own: the shape of a page header and two cards, so nothing jumps when the content arrives.
export default function Loading() {
  return (
    <PageSkeleton>
      <div className="space-y-5">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </PageSkeleton>
  );
}
