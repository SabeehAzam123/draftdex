import Link from "next/link";
import type { ComponentProps } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost" | "success";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
    primary: "bg-brand-600 text-white hover:bg-brand-700 shadow-sm",
    secondary: "bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 shadow-sm",
    danger: "bg-red-600 text-white hover:bg-red-700 shadow-sm",
    success: "bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm",
    ghost: "text-slate-700 hover:bg-slate-100",
};

const SIZES: Record<Size, string> = {
    sm: "h-8 px-3 text-sm",
    md: "h-10 px-4 text-sm",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", extra = "") {
    return `inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${extra}`;
}

type ButtonProps = ComponentProps<"button"> & { variant?: Variant; size?: Size; loading?: boolean; testId?: string };

export function Button({ variant, size, loading, testId, className = "", children, disabled, type = "button", ...rest }: ButtonProps) {
    return (
        <button
            type={type}
            data-testid={testId}
            disabled={disabled || loading}
            aria-busy={loading || undefined}
            className={buttonClass(variant, size, className)}
            {...rest}
        >
            {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
            {children}
        </button>
    );
}

type LinkButtonProps = ComponentProps<typeof Link> & { variant?: Variant; size?: Size; testId?: string };

export function LinkButton({ variant, size, testId, className = "", ...rest }: LinkButtonProps) {
    return <Link data-testid={testId} className={buttonClass(variant, size, className)} {...rest} />;
}
