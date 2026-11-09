"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { ApiError, post } from "@/lib/client/api";

export function LoginForm({ next }: { next: string }) {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({});
    const [loading, setLoading] = useState(false);

    async function onSubmit(e: FormEvent) {
        e.preventDefault();
        const found: typeof errors = {};
        if (!email.trim()) found.email = "Enter your email";
        else if (!/^\S+@\S+\.\S+$/.test(email.trim())) found.email = "Enter a valid email";
        if (!password) found.password = "Enter your password";
        setErrors(found);
        if (Object.keys(found).length) return;

        setLoading(true);
        try {
            await post("/auth/login", { email: email.trim(), password });
            window.location.href = next;
        } catch (err) {
            setErrors({ form: err instanceof ApiError ? err.message : "Sign-in failed" });
            setLoading(false);
        }
    }

    return (
        <Card className="p-6">
            <h1 data-testid="login-title" className="text-xl font-bold text-slate-900">
                Sign in
            </h1>
            <form onSubmit={onSubmit} noValidate className="mt-5 space-y-4" data-testid="login-form">
                <Field label="Email" htmlFor="login-email" error={errors.email} testId="login-email">
                    <Input
                        id="login-email"
                        testId="login-email"
                        type="email"
                        autoComplete="email"
                        value={email}
                        invalid={!!errors.email}
                        onChange={(e) => setEmail(e.target.value)}
                    />
                </Field>
                <Field label="Password" htmlFor="login-password" error={errors.password} testId="login-password">
                    <Input
                        id="login-password"
                        testId="login-password"
                        type="password"
                        autoComplete="current-password"
                        value={password}
                        invalid={!!errors.password}
                        onChange={(e) => setPassword(e.target.value)}
                    />
                </Field>
                {errors.form && (
                    <p data-testid="login-error" role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
                        {errors.form}
                    </p>
                )}
                <Button type="submit" loading={loading} className="w-full" testId="login-submit">
                    Sign in
                </Button>
            </form>
            <p className="mt-4 text-center text-sm text-slate-600">
                New here?{" "}
                <Link href="/signup" data-testid="login-signup-link" className="font-semibold text-brand-700 hover:underline">
                    Create an account
                </Link>
            </p>
            <details className="mt-5 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600" data-testid="login-demo-accounts">
                <summary className="cursor-pointer font-medium text-slate-700">Demo accounts (local copy)</summary>
                <ul className="mt-2 space-y-1 font-mono">
                    <li>admin@draftdex.test / Admin123!</li>
                    <li>coach1@draftdex.test … coach8@draftdex.test / Coach123!</li>
                </ul>
            </details>
        </Card>
    );
}
