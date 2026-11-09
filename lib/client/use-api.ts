"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Loads data with `load()` whenever `key` changes, and optionally every `refreshMs`.
 * Background refreshes keep the old data on screen and don't show the loading state.
 */
export function useLoad<T>(load: () => Promise<T>, key: string | null, refreshMs?: number) {
    const [data, setData] = useState<T | null>(null);
    const [error, setError] = useState<unknown>(null);
    const [loading, setLoading] = useState(key !== null);
    const loadRef = useRef(load);
    loadRef.current = load;
    const seq = useRef(0);

    const run = useCallback(async (background: boolean) => {
        const mine = ++seq.current;
        if (!background) setLoading(true);
        try {
            const result = await loadRef.current();
            if (mine === seq.current) {
                setData(result);
                setError(null);
            }
        } catch (err) {
            if (mine === seq.current) setError(err);
        } finally {
            if (mine === seq.current) setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (key === null) return;
        void run(false);
        if (!refreshMs) return;
        const timer = setInterval(() => {
            if (document.visibilityState === "visible") void run(true);
        }, refreshMs);
        return () => clearInterval(timer);
    }, [key, refreshMs, run]);

    const reload = useCallback(() => run(true), [run]);
    return { data, error, loading, reload, setData };
}
