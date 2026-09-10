import React from "react";
import { cn } from "@/lib/utils";

/**
 * The input styling and label rhythm the auth screens share.
 *
 * `/register` and `/register/complete` are two steps of one flow, and each had
 * its own `INPUT` and `LABEL` constant. They had already drifted — different
 * heights (`min-h` vs a fixed `h`), different focus treatments (a maroon border
 * vs a gray ring), different label weights — so the second step visibly did not
 * belong to the first. There is one definition now, and it is `/register`'s,
 * because that is the screen the design was set on.
 *
 * Deliberately not a `<Input>` wrapper component: the two screens need
 * `<input>`, `<select>` and `<textarea>` with wildly different props, and a
 * wrapper would end up re-exporting every native attribute. A class constant
 * composes with `cn()` and stays out of the way.
 */
export const FIELD_INPUT =
  "block h-[52px] w-full rounded-xl border border-gray-300 bg-white px-4 text-[15px] text-gray-900 placeholder:text-gray-400 transition-colors focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900";

/**
 * The same box, in its invalid state.
 *
 * `red-500` and not `red-400`: `globals.css` defines the 50/100/200 and
 * 500-900 steps of the red ramp but NOT 300 or 400, and an undefined shade
 * falls through to Tailwind's stock palette — which rendered as near-black
 * here. Any red used on this screen must be a step the theme actually defines.
 */
export const FIELD_INPUT_INVALID =
  "border-red-500 focus:border-red-600 focus:ring-red-600";

export function Field({
  label,
  htmlFor,
  icon,
  hint,
  /** Rendered under the field in red, and wired to `aria-describedby`. */
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  icon?: React.ReactNode;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-gray-800"
      >
        {icon}
        {label}
      </label>
      {children}
      {/* The hint stays visible alongside an error rather than being replaced by
          it: the error says what is wrong, the hint says what is wanted, and a
          person correcting a field needs both. */}
      {hint && (
        <p id={`${htmlFor}-hint`} className="mt-1.5 text-xs leading-relaxed text-gray-500">
          {hint}
        </p>
      )}
      {error && (
        <p
          id={`${htmlFor}-error`}
          role="alert"
          className="mt-1.5 text-xs font-medium leading-relaxed text-red-600"
        >
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * `aria-describedby` for a field that may have a hint, an error, or both.
 *
 * Returns undefined rather than an empty string when there is neither, because
 * `aria-describedby=""` points at nothing and some screen readers announce the
 * attribute anyway.
 */
export function describedBy(id: string, opts: { hint?: boolean; error?: boolean }): string | undefined {
  const ids = [opts.hint && `${id}-hint`, opts.error && `${id}-error`].filter(Boolean);
  return ids.length ? ids.join(" ") : undefined;
}

/**
 * A titled group of fields.
 *
 * Eight inputs in a flat stack is what made the completion screen read as
 * unfinished — nothing told the person how much was left or why a bank-adjacent
 * question sat next to a question about weaving. Three named groups answer both.
 */
export function FieldSection({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("border-t border-gray-200 pt-6", className)}>
      <h2 className="kg-label font-semibold text-gray-500">{title}</h2>
      {description && (
        <p className="mt-1.5 text-[13px] leading-relaxed text-gray-500">{description}</p>
      )}
      <div className="mt-5 space-y-5">{children}</div>
    </section>
  );
}
