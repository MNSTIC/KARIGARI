"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useLanguage } from "@/lib/translations";
import { useSession } from "@/lib/useSession";

/**
 * "You are already signed in" — shown on `/login` and `/register`.
 *
 * WHY A BANNER AND NOT A REDIRECT. Bouncing a signed-in visitor straight to
 * their dashboard is what most apps do, and it is wrong for this one. Karigari
 * is used on shared phones — there is a whole assisted-onboarding flow built on
 * the assumption that one person holds the device while another speaks — so
 * "reach the login form while someone else's session exists" is a real, ordinary
 * thing to need here, not an edge case. A hard redirect makes it impossible
 * without first knowing to find the logout button inside an account that is not
 * yours.
 *
 * So: the fast path is offered, loudly, at the top of the page, and the form
 * underneath still works. Nobody has to type a password they have already
 * given, and nobody is locked out of signing in as themselves.
 *
 * Renders nothing at all while the check is in flight or when signed out, so a
 * genuinely signed-out visitor never sees a flash of something irrelevant on
 * the way to the form.
 */
export function AlreadySignedInBanner() {
  const { t } = useLanguage();
  const session = useSession();

  if (session.status !== "signedIn") return null;

  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[var(--color-pill)] px-4 py-3">
      <p className="text-[13px] font-medium text-gray-800">{t("auth_already_signed_in")}</p>
      <Link
        href={session.dashboard ?? "/artisan/dashboard"}
        className="kg-press inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-full bg-[var(--color-maroon)] px-4 text-[13px] font-semibold text-[#F0A48C] transition-colors hover:bg-[#6B2020]"
      >
        {t("nav_go_to_dashboard")}
        <ArrowRight size={14} />
      </Link>
    </div>
  );
}
