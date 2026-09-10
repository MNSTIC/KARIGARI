"use client";

import { useCallback, useEffect, useState } from "react";
import { Fingerprint, Loader2, Trash2 } from "lucide-react";
import { useLanguage } from "@/lib/translations";
import { cn } from "@/lib/utils";

/**
 * The passkeys on this account: add, list, revoke.
 *
 * Rendered ONLY for accounts that can actually use one — a `PASSWORD` account
 * is refused enrolment by the API, so showing it a section it can only be told
 * "no" by would be a dead control. The parent decides; this component returns
 * null if asked to render for one anyway.
 *
 * `credentialId` and `publicKey` are never fetched. The list exists so a person
 * can tell which authenticator to revoke, and a label plus two dates answers
 * that.
 */

interface PasskeyRow {
  id: string;
  deviceLabel: string | null;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

const PASSKEY_ENABLED = process.env.NEXT_PUBLIC_PASSKEY_ENABLED === "true";

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

export function SignInMethods({ authProvider }: { authProvider: string }) {
  const { t } = useLanguage();
  const [rows, setRows] = useState<PasskeyRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    // Deferred by a macrotask so the effect body performs no synchronous
    // setState — the same kickoff pattern the rest of this app uses.
    const kickoff = setTimeout(() => {
      setSupported(
        typeof window !== "undefined" && typeof window.PublicKeyCredential === "function"
      );
    }, 0);
    return () => clearTimeout(kickoff);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/passkey", { cache: "no-store" });
      const data = await res.json();
      if (res.ok && data?.success) setRows(data.passkeys);
      else setRows([]);
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => {
    if (authProvider === "PASSWORD" || !PASSKEY_ENABLED) return;
    // Deferred a macrotask so the effect body performs no synchronous setState.
    const kickoff = setTimeout(load, 0);
    return () => clearTimeout(kickoff);
  }, [authProvider, load]);

  // A password account keeps its password. Enrolment is refused server-side, so
  // the section is hidden rather than shown and then denied.
  if (authProvider === "PASSWORD" || !PASSKEY_ENABLED) return null;

  const add = async () => {
    setBusy(true);
    setError("");
    try {
      const optionsRes = await fetch("/api/auth/passkey/register/options", { method: "POST" });
      const optionsData = await optionsRes.json();
      if (!optionsRes.ok || !optionsData?.success) {
        setError(optionsData?.error || t("passkey_failed"));
        return;
      }

      const { startRegistration } = await import("@simplewebauthn/browser");
      const attestation = await startRegistration({ optionsJSON: optionsData.options });

      const verifyRes = await fetch("/api/auth/passkey/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: attestation }),
      });
      const result = await verifyRes.json();
      if (!verifyRes.ok || !result?.success) {
        setError(result?.error || t("passkey_failed"));
        return;
      }
      await load();
    } catch (e) {
      const name = (e as { name?: string })?.name;
      if (name !== "NotAllowedError" && name !== "AbortError") {
        console.error("Passkey enrolment failed:", e);
        setError(t("passkey_failed"));
      }
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/passkey", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        // Includes the "this is your only way in" refusal, which is a real
        // answer rather than a failure.
        setError(data?.error || t("passkey_remove_failed"));
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-6 border-t border-gray-100 pt-5">
      <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-500">
        {t("passkey_section_title")}
      </h3>

      {rows === null ? (
        <div className="flex items-center gap-2 py-3 text-xs text-gray-500">
          <Loader2 size={13} className="animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <p className="mt-2 text-[13px] leading-relaxed text-gray-500">
          {t("passkey_none")}
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-3"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-pill)] text-gray-600">
                <Fingerprint size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-bold text-gray-900">
                  {row.deviceLabel || t("passkey_unnamed")}
                </p>
                <p className="text-[11px] text-gray-500">
                  {t("passkey_added_on")} {shortDate(row.createdAt)}
                  {row.lastUsedAt
                    ? ` · ${t("passkey_last_used")} ${shortDate(row.lastUsedAt)}`
                    : ` · ${t("passkey_never_used")}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void revoke(row.id)}
                disabled={busy}
                aria-label={t("passkey_remove")}
                title={t("passkey_remove")}
                className={cn(
                  "kg-press flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-red-600 hover:bg-red-50",
                  busy && "cursor-not-allowed opacity-50"
                )}
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {supported ? (
        <button
          type="button"
          onClick={() => void add()}
          disabled={busy}
          className={cn(
            "kg-press mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-gray-100 px-4 text-[13px] font-bold text-gray-800 hover:bg-gray-200",
            busy && "cursor-not-allowed opacity-50"
          )}
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Fingerprint size={14} />}
          {t("passkey_add_cta")}
        </button>
      ) : (
        // An honest dead end rather than a button that cannot work.
        <p className="mt-3 text-[12px] text-gray-500">{t("passkey_unsupported")}</p>
      )}

      {error && (
        <p role="alert" className="mt-2 text-[12px] font-bold text-red-600">
          {error}
        </p>
      )}
    </section>
  );
}
