import type { ReactNode } from "react";

export function Card({ children, className = "", testId }: { children: ReactNode; className?: string; testId?: string }) {
    return (
        <section data-testid={testId} className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
            {children}
        </section>
    );
}

export function CardHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
    return (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div>
                <h2 className="text-base font-semibold text-slate-900">{title}</h2>
                {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
            </div>
            {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
    );
}

export function CardBody({ children, className = "" }: { children: ReactNode; className?: string }) {
    return <div className={`px-5 py-4 ${className}`}>{children}</div>;
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
    return (
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
                <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
                {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
            </div>
            {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
    );
}

/** A label / value pair in a definition grid. */
export function Stat({ label, value, testId }: { label: string; value: ReactNode; testId?: string }) {
    return (
        <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
            <dd data-testid={testId} className="mt-1 text-sm font-semibold text-slate-900">
                {value}
            </dd>
        </div>
    );
}
