"use client";

import { useEffect, type ReactNode } from "react";

/** A dialog. Escape or a click outside closes it. Test ids: `${testId}`, `${testId}-title`, `${testId}-close`. */
export function Modal({
    open,
    title,
    onClose,
    testId,
    children,
    footer,
    wide,
}: {
    open: boolean;
    title: string;
    onClose: () => void;
    testId: string;
    children: ReactNode;
    footer?: ReactNode;
    wide?: boolean;
}) {
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, onClose]);

    if (!open) return null;
    return (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" onMouseDown={onClose}>
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby={`${testId}-title`}
                data-testid={testId}
                className={`w-full ${wide ? "max-w-2xl" : "max-w-md"} rounded-xl bg-white shadow-xl`}
                onMouseDown={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                    <h2 id={`${testId}-title`} data-testid={`${testId}-title`} className="text-base font-semibold text-slate-900">
                        {title}
                    </h2>
                    <button data-testid={`${testId}-close`} aria-label="Close" onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                        ✕
                    </button>
                </div>
                <div className="px-5 py-4">{children}</div>
                {footer && <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</div>}
            </div>
        </div>
    );
}
