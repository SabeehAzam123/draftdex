"use client";

import React, { useEffect, useState } from "react";
import { getUser, clearSession } from "@/lib/client/authStore";

export default function DashboardPage() {
    const [role, setRole] = useState<string>("");

    useEffect(() => {
        const u = getUser();
        if (!u) {
            window.location.href = "/login";
            return;
        }
        setRole(u.role);
    }, []);

    return (
        <div style={{ maxWidth: 900, margin: "40px auto", padding: 16 }}>
            <h1 data-testid="dashboard-title">Dashboard</h1>
            <div data-testid="current-role">Role: {role}</div>

            <div style={{ marginTop: 16, display: "flex", gap: 12 }}>
                <a data-testid="nav-users" href="/users">
                    Users
                </a>
                <button
                    data-testid="logout-btn"
                    onClick={() => {
                        clearSession();
                        window.location.href = "/login";
                    }}
                >
                    Logout
                </button>
            </div>
        </div>
    );
}
