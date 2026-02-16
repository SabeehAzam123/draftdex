"use client";

import React, { useState } from "react";
import { apiPost, ApiError } from "@/lib/client/api";
import { setSession } from "@/lib/client/authStore";
import { Toast } from "@/components/ui/Toast";

export default function LoginPage() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");

    const [loading, setLoading] = useState(false);
    const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

    const [emailErr, setEmailErr] = useState<string | null>(null);
    const [passErr, setPassErr] = useState<string | null>(null);

    function validate() {
        let ok = true;
        setEmailErr(null);
        setPassErr(null);

        if (!email.trim()) {
            setEmailErr("Email is required");
            ok = false;
        } else if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
            setEmailErr("Email is invalid");
            ok = false;
        }

        if (!password.trim()) {
            setPassErr("Password is required");
            ok = false;
        }

        return ok;
    }

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!validate()) return;

        setLoading(true);
        setToast(null);

        try {
            const res = await apiPost("/auth/login", { email, password });
            setSession(res.data.token, res.data.user);
            setToast({ type: "success", message: "Logged in" });
            window.location.href = "/dashboard";
        } catch (err: any) {
            const apiErr = err as ApiError;
            setToast({ type: "error", message: apiErr?.message || "Login failed" });
        } finally {
            setLoading(false);
        }
    }

    return (
        <div style={{ maxWidth: 420, margin: "80px auto", padding: 16 }}>
            <h1 data-testid="login-title">Login</h1>

            <form onSubmit={onSubmit}>
                <label>
                    Email
                    <input
                        data-testid="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        style={{ width: "100%", padding: 10, marginTop: 6, marginBottom: 6 }}
                        placeholder="admin@test.com"
                    />
                </label>
                {emailErr && (
                    <div data-testid="email-error" style={{ color: "crimson", marginBottom: 10 }}>
                        {emailErr}
                    </div>
                )}

                <label>
                    Password
                    <input
                        data-testid="password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        style={{ width: "100%", padding: 10, marginTop: 6, marginBottom: 6 }}
                        placeholder="Admin123!"
                    />
                </label>
                {passErr && (
                    <div data-testid="password-error" style={{ color: "crimson", marginBottom: 10 }}>
                        {passErr}
                    </div>
                )}

                <button
                    data-testid="login-submit"
                    disabled={loading}
                    style={{ width: "100%", padding: 12, cursor: loading ? "not-allowed" : "pointer" }}
                >
                    {loading ? "Logging in..." : "Login"}
                </button>

                {loading && <div data-testid="login-loading" style={{ marginTop: 10 }}>Loading...</div>}
            </form>

            {toast && <Toast type={toast.type} message={toast.message} />}
        </div>
    );
}
