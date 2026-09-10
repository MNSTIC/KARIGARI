"use client";

import { useEffect, useState } from "react";

/**
 * "Is this visitor already signed in?", for the public screens.
 *
 * The landing page, `/login` and `/register` are all client components, so they
 * cannot read the httpOnly cookie themselves — `/api/auth/session` is the only
 * way they can know, and it is deliberately cheap enough to ask on every load.
 *
 * THREE STATES, NOT TWO. `status` starts as `"checking"` and callers must
 * render for it. A boolean alone would force every caller to treat "we have not
 * asked yet" as "signed out", which flashes a Login button in front of someone
 * who is already signed in — the exact flicker this hook exists to avoid.
 */

export type SessionStatus = "checking" | "signedIn" | "signedOut";

export interface SessionState {
  status: SessionStatus;
  role: string | null;
  /** Where this person's dashboard is. Null until we know they have one. */
  dashboard: string | null;
}

export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({
    status: "checking",
    role: null,
    dashboard: null,
  });

  useEffect(() => {
    // Guards against setting state after the component has gone — a visitor who
    // taps straight through the landing page unmounts this mid-flight.
    let alive = true;

    // Deferred by a macrotask so the effect body performs no synchronous
    // setState — the same kickoff pattern the rest of this app uses.
    const kickoff = setTimeout(async () => {
      try {
        const res = await fetch("/api/auth/session", { cache: "no-store" });
        const data = await res.json();
        if (!alive) return;

        if (data?.signedIn) {
          setState({
            status: "signedIn",
            role: data.role ?? null,
            dashboard: data.dashboard ?? null,
          });
        } else {
          setState({ status: "signedOut", role: null, dashboard: null });
        }
      } catch {
        // Offline, or the request failed. Treated as signed out: this only ever
        // decides which button to show, and showing "Sign in" to someone who
        // turns out to have a session costs them one extra tap, whereas the
        // reverse sends them to a dashboard that cannot load.
        if (alive) setState({ status: "signedOut", role: null, dashboard: null });
      }
    }, 0);

    return () => {
      alive = false;
      clearTimeout(kickoff);
    };
  }, []);

  return state;
}
