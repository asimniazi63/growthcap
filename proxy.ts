import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// The webhook, OAuth callback and cron routes are public: each one checks its own signature, state or secret.
const isPublic = createRouteMatcher([
  "/", // the public landing page; a signed-in visitor is sent on to /overview
  "/sign-in(.*)",
  "/api/webhooks/(.*)",
  "/api/shopify/callback",
  "/api/cron/(.*)",
]);

export default clerkMiddleware(async (auth, request) => {
  if (!isPublic(request)) await auth.protect();
});

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
