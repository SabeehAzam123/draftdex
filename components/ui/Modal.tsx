"use client";

import React from "react";

export function Modal({
                          title,
                          open,
                          onClose,
                          testId,
                          children,
                      }: {
    title: string;
    open: boolean;
    onClose: () => void;
    testId: string;
    children: React.ReactNode;
}) {
    if (!open) return null;

    return (
        <div
            data-testid={testId}
            style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.35)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 9998,
            }}
            onMouseDown={onClose}
        >
            <div
                style={{ width: 520, background: "#fff", borderRadius: 12, padding: 16 }}
                onMouseDown={(e) => e.stopPropagation()}
            >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <h3 data-testid={`${testId}-title`}>{title}</h3>
                    <button data-testid={`${testId}-close`} onClick={onClose}>
                        ✕
                    </button>
                </div>
                <div style={{ marginTop: 12 }}>{children}</div>
            </div>
        </div>
    );
}
