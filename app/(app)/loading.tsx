// Shown while a page loads: the shape of a page header and two cards, so nothing jumps when the content arrives.
export default function Loading() {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Loading…</span>
      <div className="mb-8" aria-hidden>
        <div className="skeleton h-8 w-48 max-w-full" />
        <div className="skeleton mt-3 h-4 w-96 max-w-full" />
      </div>
      <div className="space-y-5" aria-hidden>
        {[0, 1].map((i) => (
          <div key={i} className="card card-pad space-y-3">
            <div className="skeleton h-5 w-40 max-w-full" />
            <div className="skeleton h-4 w-full" />
            <div className="skeleton h-4 w-5/6" />
            <div className="skeleton h-4 w-2/3" />
          </div>
        ))}
      </div>
    </div>
  );
}
