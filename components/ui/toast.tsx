"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { ApiError } from "@/lib/client/api";

type ToastItem = { id: number; type: "success" | "error"; message: string; traceId?: string | null };
type ToastApi = { success: (message: string) => void; error: (err: unknown, fallback?: string) => void };

const ToastContext = createContext<ToastApi | null>(null);

/**
 * Pop-up messages. Test ids: `toast` (each one, with data-type="success|error"), `toast-message`, `toast-trace`.
 * Errors from the API show their trace id, so a tester can quote it in a bug report.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
    const [items, setItems] = useState<ToastItem[]>([]);

    const push = useCallback((t: Omit<ToastItem, "id">) => {
        const id = Date.now() + Math.random();
        setItems((list) => [...list.slice(-3), { ...t, id }]);
        setTimeout(() => setItems((list) => list.filter((i) => i.id !== id)), t.type === "error" ? 8000 : 4000);
    }, []);

    const api = useMemo<ToastApi>(
        () => ({
            success: (message) => push({ type: "success", message }),
            error: (err, fallback = "Something went wrong") => {
                if (err instanceof ApiError) push({ type: "error", message: err.message, traceId: err.traceId });
                else push({ type: "error", message: err instanceof Error ? err.message : fallback });
            },
        }),
        [push],
    );

    return (
        <ToastContext.Provider value={api}>
            {children}
            <div className="pointer-events-none fixed right-4 top-4 z-50 flex w-80 flex-col gap-2" aria-live="polite">
                {items.map((t) => (
                    <div
                        key={t.id}
                        data-testid="toast"
                        data-type={t.type}
                        role={t.type === "error" ? "alert" : "status"}
                        className={`pointer-events-auto rounded-lg border px-4 py-3 text-sm shadow-lg ${
                            t.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-900"
                        }`}
                    >
                        <p data-testid="toast-message" className="font-medium">
                            {t.message}
                        </p>
                        {t.traceId && (
                            <p data-testid="toast-trace" className="mt-1 font-mono text-[11px] opacity-70">
                                trace {t.traceId}
                            </p>
                        )}
                    </div>
                ))}
            </div>
        </ToastContext.Provider>
    );
}

export function useToast(): ToastApi {
    const ctx = useContext(ToastContext);
    if (!ctx) throw new Error("useToast needs <ToastProvider>");
    return ctx;
}
