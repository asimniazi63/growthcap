import Link from "next/link";
import { BrandMark } from "@/components/shell/brand";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-paper px-4 py-10">
      <div className="flex max-w-sm flex-col items-center text-center">
        <BrandMark className="size-10" />
        <h1 className="page-title mt-6">This page doesn&apos;t exist</h1>
        <p className="muted mt-2">The link may be old or mistyped. Go back to the chat to keep working.</p>
        <Link href="/chat" className="btn btn-primary mt-6">
          Back to chat
        </Link>
      </div>
    </main>
  );
}
