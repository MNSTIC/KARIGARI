"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Fingerprint, Loader2 } from "lucide-react";
import { useLanguage } from "@/lib/translations";
import { dashboardFor } from "@/lib/dashboardRoutes";
import { cn } from "@/lib/utils";

/**
 * "Continue with Google" and "Sign in with a passkey".
 *
 * Both buttons are gated TWICE: on the deployment flag, and on the browser
 * actually being able to do the thing. An unsupported browser gets no button at
 * all rather than one that fails when pressed — the WebAuthn check is
 * `window.PublicKeyCredential`, which is the feature detection the spec itself
 * defines.
 *
 * `NEXT_PUBLIC_*` here is deliberate and safe: both values are booleans that
 * decide whether a control renders. No secret has a NEXT_PUBLIC_ alias
 * anywhere in this app, and adding one would inline it into the browser bundle.
 */

const GOOGLE_ENABLED = process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true";
const PASSKEY_ENABLED = process.env.NEXT_PUBLIC_PASSKEY_ENABLED === "true";

/**
 * Google's "G", inline.
 *
 * Not fetched from a CDN: the artifact CSP forbids remote images and the
 * offline PWA would render a broken box on a train. Four paths, Google's own
 * brand colours, which are the one exception to the token palette because a
 * recoloured Google mark is a trademark problem rather than a design choice.
 */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

export function AltSignIn({
  role = "ARTISAN",
  /** Register screens show only Google — a passkey needs an account first. */
  showPasskey = true,
}: {
  role?: "ARTISAN" | "ADMIN";
  showPasskey?: boolean;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const [passkeySupported, setPasskeySupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Feature detection runs in an effect, not during render: `window` does not
  // exist on the server, and a mismatch between the two would hydrate wrong.
  useEffect(() => {
    // Deferred by a macrotask so the effect body performs no synchronous
    // setState — the same kickoff pattern the rest of this app uses.
    const kickoff = setTimeout(() => {
      setPasskeySupported(
        typeof window !== "undefined" && typeof window.PublicKeyCredential === "function"
      );
    }, 0);
    return () => clearTimeout(kickoff);
  }, []);

  const showGoogle = GOOGLE_ENABLED;
  const showPasskeyButton = PASSKEY_ENABLED && showPasskey && passkeySupported;
  if (!showGoogle && !showPasskeyButton) return null;

  const signInWithPasskey = async () => {
    setBusy(true);
    setError("");
    try {
      const optionsRes = await fetch("/api/auth/passkey/login/options", { method: "POST" });
      const optionsData = await optionsRes.json();
      if (!optionsRes.ok || !optionsData?.success) {
        setError(optionsData?.error || t("passkey_failed"));
        return;
      }

      // Imported here rather than at module scope so the WebAuthn bundle is not
      // shipped to every visitor who merely opens the login page.
      const { startAuthentication } = await import("@simplewebauthn/browser");
      const assertion = await startAuthentication({ optionsJSON: optionsData.options });

      const verifyRes = await fetch("/api/auth/passkey/login/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: assertion }),
      });
      const result = await verifyRes.json();
      if (!verifyRes.ok || !result?.success) {
        setError(result?.error || t("passkey_failed"));
        return;
      }

      router.push(dashboardFor(result.role));
      router.refresh();
    } catch (e) {
      // A cancelled prompt throws. That is not an error worth shouting about —
      // the person changed their mind.
      const name = (e as { name?: string })?.name;
      if (name !== "NotAllowedError" && name !== "AbortError") {
        console.error("Passkey sign-in failed:", e);
        setError(t("passkey_failed"));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-8">
      <div className="relative flex items-center py-2">
        <div className="flex-grow border-t border-black/10"></div>
        <span className="px-3 text-[12px] font-medium text-gray-500">
          {t("auth_or")}
        </span>
        <div className="flex-grow border-t border-black/10"></div>
      </div>

      <div className="mt-6 space-y-3">
        {showGoogle && (
          <a
            href={`/api/auth/google/start?role=${role}`}
            className="kg-press flex min-h-[50px] w-full items-center justify-center gap-3 rounded-xl border border-white/80 bg-white shadow-sm text-[14px] font-semibold text-gray-800 transition-colors hover:bg-gray-50/90"
          >
            <GoogleMark />
            {t("auth_continue_google")}
          </a>
        )}

        {showPasskeyButton && (
          <button
            type="button"
            onClick={() => void signInWithPasskey()}
            disabled={busy}
            className={cn(
              "kg-press flex min-h-[50px] w-full items-center justify-center gap-2 rounded-xl bg-black/[0.04] border border-black/[0.04] backdrop-blur-sm text-[14px] font-semibold text-gray-800 transition-colors hover:bg-black/[0.08]",
              busy && "cursor-not-allowed opacity-60"
            )}
          >
            {busy ? (
              <Loader2 size={17} className="animate-spin" />
            ) : (
              <Fingerprint size={17} />
            )}
            {t("passkey_sign_in")}
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 text-[13px] font-medium text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
