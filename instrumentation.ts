// Next.js calls register() once when the server starts. Langfuse tracing starts only when its three variables are set.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY || !process.env.LANGFUSE_BASE_URL) return;
  const { startTracing } = await import("./lib/ops/tracing");
  startTracing();
}
