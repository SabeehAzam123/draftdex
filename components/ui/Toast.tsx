"use client";

import React from "react";

export function Toast({ message, type }: { message: string; type: "success" | "error" }) {
    return (
        <div
            data-testid="toast"
            role="alert"
            style={{
                position: "fixed",
                top: 16,
                right: 16,
                padding: 12,
                borderRadius: 8,
                background: type === "success" ? "#e7ffe7" : "#ffe7e7",
                border: "1px solid #ddd",
                minWidth: 260,
                zIndex: 9999,
            }}
        >
            <div data-testid="toast-type" style={{ fontWeight: 700 }}>
                {type.toUpperCase()}
            </div>
            <div data-testid="toast-message">{message}</div>
        </div>
    );
}
