/**
 * Where a freshly signed-in user lands, by role.
 *
 * ITS OWN FILE, WITH NO IMPORTS, ON PURPOSE. This is called from both server
 * routes and `"use client"` components (`AltSignIn`, the completion page). Its
 * first home was `googleSignup.ts`, which imports `@prisma/client` — and a
 * client component importing from there would pull the Prisma client into the
 * browser bundle. Keep this module dependency-free.
 *
 * WHY A FUNCTION AT ALL. `/admin/dashboard` does not exist in this app — there
 * is only `/admin/facilitator` and `/admin/nodal` — and three separate places
 * were sending admins to it, so every Google or passkey admin sign-in 404'd.
 * One function now, so the next person to add a sign-in path cannot invent a
 * fourth wrong route.
 */
export function dashboardFor(role: string): string {
  return role === 'ADMIN' ? '/admin/facilitator' : '/artisan/dashboard';
}
