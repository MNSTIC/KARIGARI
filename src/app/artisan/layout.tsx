"use client";

import { useEffect, useState } from "react";
import { VoiceOnboarding } from "@/components/VoiceOnboarding";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { AppShell } from "@/components/ui/AppShell";

/**
 * Auth guard + chrome for every artisan route.
 *
 * The page title used to live here as a per-route table, because the old header
 * drew one. The redesigned pages each open with their own large serif title, so
 * the shell no longer owns that — it owns the rail, the search/notification bar
 * and the voice assistant, all of which have to survive a tab change without
 * remounting.
 */
export default function ArtisanLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me')
      .then(res => res.json())
      .then(data => {
        if (!data.success) {
          router.replace('/login');
        } else if (data.role !== 'ARTISAN') {
          router.replace(data.role === 'ADMIN' ? '/admin/facilitator' : '/login');
        } else {
          setAuthorized(true);
        }
      })
      .catch(() => {
        // No network is not a signed-out session. An artisan who reopens the
        // app at a haat with no signal must reach their saved pages and the
        // offline queues; every API call still checks the session cookie
        // server-side the moment it can reach the server.
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          setAuthorized(true);
          return;
        }
        router.replace('/login');
      });
  }, [router]);

  if (!authorized) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-background)]">
        <Loader2 className="animate-spin text-[var(--color-primary)]" size={32} />
      </div>
    );
  }

  return (
    <>
      <AppShell
        role="ARTISAN"
        // The dashboard already opens the profile editor from `?edit=profile`.
        // Reusing that deep link keeps the modal and its data in the one place
        // that already loads the full profile.
        onProfileClick={() => {
          if (pathname === "/artisan/dashboard") {
            window.dispatchEvent(
              new CustomEvent("karigari:assistant-action", {
                detail: { type: "OPEN_PROFILE" },
              })
            );
          } else {
            router.push("/artisan/dashboard?edit=profile");
          }
        }}
      >
        {children}
      </AppShell>
      {/* AI Learning docks a full voice-capable assistant of its own, and the
          floating bubble lands on top of that panel's send button. One
          assistant per screen. */}
      {!pathname?.startsWith("/artisan/learn") && <VoiceOnboarding currentRoute={pathname} />}
    </>
  );
}
