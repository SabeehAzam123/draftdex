"use client";

import type { ReactNode } from "react";
import { ApiError } from "@/lib/client/api";
import { Button } from "./button";

export function Spinner({ label = "Loading…", testId = "loading" }: { label?: string; testId?: string }) {
    return (
        <div data-testid={testId} role="status" className="flex items-center justify-center gap-3 py-12 text-sm text-slate-500">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" aria-hidden />
            {label}
        </div>
    );
}

export function EmptyState({ title, children, action, testId }: { title: string; children?: ReactNode; action?: ReactNode; testId?: string }) {
    return (
        <div data-testid={testId} className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
            <p className="text-base font-semibold text-slate-800">{title}</p>
            {children && <div className="mx-auto mt-1 max-w-md text-sm text-slate-500">{children}</div>}
            {action && <div className="mt-4">{action}</div>}
        </div>
    );
}

/** An API error in place of the content, with its code and trace id for bug reports. */
export function ErrorBanner({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
    const api = error instanceof ApiError ? error : null;
    return (
        <div data-testid="error-banner" role="alert" className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-900">
            <p className="font-semibold">{api?.message ?? (error instanceof Error ? error.message : "Something went wrong")}</p>
            {api && (
                <p data-testid="error-banner-meta" className="mt-1 font-mono text-xs opacity-75">
                    {api.code} · HTTP {api.status}
                    {api.traceId ? ` · trace ${api.traceId}` : ""}
                </p>
            )}
            {onRetry && (
                <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry} testId="error-banner-retry">
                    Try again
                </Button>
            )}
        </div>
    );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
    const pages = Math.max(1, Math.ceil(total / pageSize));
    if (total === 0) return null;
    const from = (page - 1) * pageSize + 1;
    const to = Math.min(total, page * pageSize);
    return (
        <div className="flex items-center justify-between gap-3 pt-4 text-sm text-slate-600">
            <span data-testid="pager-info">
                {from}–{to} of {total}
            </span>
            <div className="flex gap-2">
                <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} testId="pager-prev">
                    Previous
                </Button>
                <span className="self-center" data-testid="pager-page">
                    Page {page} of {pages}
                </span>
                <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)} testId="pager-next">
                    Next
                </Button>
            </div>
        </div>
    );
}
