import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// All routes are protected — no public routes on this personal dashboard.
// Unauthenticated visitors are redirected to Clerk's hosted sign-in page.
const isPublicRoute = createRouteMatcher([
  // Clerk's own auth routes must stay public
  "/sign-in(.*)",
  "/sign-up(.*)",
]);

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
