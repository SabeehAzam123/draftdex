import type { ComponentProps, ReactNode } from "react";

const CONTROL =
    "block rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:bg-slate-100 disabled:text-slate-500";
const INVALID = "border-red-400 focus:border-red-500 focus:ring-red-100";

/**
 * A labelled control with its hint and error. The control gets `testId`; the error `${testId}-error`.
 */
export function Field({
    label,
    htmlFor,
    hint,
    error,
    testId,
    children,
}: {
    label: string;
    htmlFor: string;
    hint?: ReactNode;
    error?: string;
    testId?: string;
    children: ReactNode;
}) {
    return (
        <div className="space-y-1">
            <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-700">
                {label}
            </label>
            {children}
            {hint && !error && <p className="text-xs text-slate-500">{hint}</p>}
            {error && (
                <p data-testid={testId ? `${testId}-error` : undefined} role="alert" className="text-xs font-medium text-red-600">
                    {error}
                </p>
            )}
        </div>
    );
}

/** Full width unless the caller gives a width (e.g. `w-56` on a filter box). */
const classes = (invalid: boolean | undefined, className: string, extra = "") =>
    `${CONTROL} ${/(^|\s)(w-|min-w-)/.test(className) ? "" : "w-full"} ${invalid ? INVALID : ""} ${extra} ${className}`;

export function Input({ invalid, testId, className = "", ...rest }: ComponentProps<"input"> & { invalid?: boolean; testId?: string }) {
    return <input data-testid={testId} aria-invalid={invalid || undefined} className={classes(invalid, className)} {...rest} />;
}

export function Select({ invalid, testId, className = "", ...rest }: ComponentProps<"select"> & { invalid?: boolean; testId?: string }) {
    return <select data-testid={testId} aria-invalid={invalid || undefined} className={classes(invalid, className)} {...rest} />;
}

export function Textarea({ invalid, testId, className = "", ...rest }: ComponentProps<"textarea"> & { invalid?: boolean; testId?: string }) {
    return <textarea data-testid={testId} aria-invalid={invalid || undefined} className={classes(invalid, className, "font-mono")} {...rest} />;
}
