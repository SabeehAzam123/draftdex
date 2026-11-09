"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { ApiError, fieldErrors, post } from "@/lib/client/api";

export default function SignupPage() {
    const [form, setForm] = useState({ displayName: "", email: "", password: "" });
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(false);
    const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

    async function onSubmit(e: FormEvent) {
        e.preventDefault();
        setLoading(true);
        setErrors({});
        try {
            await post("/auth/signup", form);
            window.location.href = "/leagues";
        } catch (err) {
            const fields = fieldErrors(err);
            setErrors(Object.keys(fields).length ? fields : { form: err instanceof ApiError ? err.message : "Sign-up failed" });
            setLoading(false);
        }
    }

    return (
        <Card className="p-6">
            <h1 data-testid="signup-title" className="text-xl font-bold text-slate-900">
                Create your account
            </h1>
            <p className="mt-1 text-sm text-slate-500">You start with 1,000 credits for league entry fees.</p>
            <form onSubmit={onSubmit} noValidate className="mt-5 space-y-4" data-testid="signup-form">
                <Field label="Display name" htmlFor="signup-name" error={errors.displayName} testId="signup-name">
                    <Input id="signup-name" testId="signup-name" value={form.displayName} onChange={set("displayName")} invalid={!!errors.displayName} />
                </Field>
                <Field label="Email" htmlFor="signup-email" error={errors.email} testId="signup-email">
                    <Input id="signup-email" testId="signup-email" type="email" autoComplete="email" value={form.email} onChange={set("email")} invalid={!!errors.email} />
                </Field>
                <Field label="Password" htmlFor="signup-password" hint="At least 8 characters, with a letter and a number" error={errors.password} testId="signup-password">
                    <Input
                        id="signup-password"
                        testId="signup-password"
                        type="password"
                        autoComplete="new-password"
                        value={form.password}
                        onChange={set("password")}
                        invalid={!!errors.password}
                    />
                </Field>
                {errors.form && (
                    <p data-testid="signup-error" role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
                        {errors.form}
                    </p>
                )}
                <Button type="submit" loading={loading} className="w-full" testId="signup-submit">
                    Create account
                </Button>
            </form>
            <p className="mt-4 text-center text-sm text-slate-600">
                Already have an account?{" "}
                <Link href="/login" data-testid="signup-login-link" className="font-semibold text-brand-700 hover:underline">
                    Sign in
                </Link>
            </p>
        </Card>
    );
}
