"use client";

import type { useRouter } from "next/navigation";
import { clearLearningCache } from "@/lib/learningCache";

/**
 * Sign the current session out, from anywhere in the app.
 *
 * `auth-token` is httpOnly, so only the server can clear it — the POST is the
 * whole logout, and the redirect afterwards is what the artisan actually sees.
 * The request is allowed to fail: a network error must still take them off a
 * screen they can no longer load data for, so the redirect happens either way.
 *
 * Shared so the top bar, the admin shell and any future caller cannot drift
 * into three slightly different versions of the same three lines.
 */
export async function logout(router: ReturnType<typeof useRouter>): Promise<void> {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } catch {
    /* Log out locally even if the request never reached the server. */
  }
  // The learn page's saved copy carries this artisan's stage and earnings; a
  // shared phone must not show them to whoever signs in next. Never throws.
  await clearLearningCache();
  router.replace("/login");
  router.refresh();
}
