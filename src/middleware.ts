import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// All USER-facing routes are protected — unauthenticated visitors are redirected
// to Clerk's hosted sign-in page. Machine endpoints (server-to-server cron, the
// Telegram webhook, the read-only reconcile check) must bypass Clerk: they are
// called by cron-job.org / Telegram with no Clerk session, so Clerk's protect()
// would 404 them (this broke the EOD report + /check,/portfolio bot on 2026-06-03).
// Each whitelisted route carries its OWN auth or is read-only:
//   /api/cron/*       — guarded by x-cron-secret === CRON_SECRET
//   /api/telegram-bot — guarded by x-telegram-bot-api-secret-token === TELEGRAM_WEBHOOK_SECRET
//   /api/reconcile    — read-only recompute; guarded by x-cron-secret === RECONCILE_SECRET
//                       (its own secret, since the autopilot worker — not a browser — calls it)
// NOTE: /api/telegram (UI test-ping) has NO secret and is intentionally LEFT
// protected by Clerk — do not add it here.
const isPublicRoute = createRouteMatcher([
  // Clerk's own auth pages
  "/sign-in(.*)",
  "/sign-up(.*)",
  // Machine endpoints — each enforces its OWN secret in-handler (defense in depth):
  "/api/cron/(.*)",      // x-cron-secret === CRON_SECRET
  "/api/telegram-bot",   // x-telegram-bot-api-secret-token
  "/api/reconcile",      // x-cron-secret === RECONCILE_SECRET
  "/api/health",         // x-cron-secret
  "/api/freshness",      // x-cron-secret === CRON_SECRET (freshness sentinel)
]);
// NOTE: /api/telegram (UI test-ping, no secret) is intentionally NOT public — stays Clerk-protected.

export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jte?|ttf|woff2?|png|jpg|jpeg|gif|svg|ico|webp)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
    // Clerk proxy path
    "/__clerk/(.*)",
  ],
};
