"use client";

import { useState } from "react";
import { useSession } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, PageHeader } from "@/components/ui/card";
import { EmptyState, ErrorBanner, Pager, Spinner } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { apiPage, del, fieldErrors, patch, post, query } from "@/lib/client/api";
import { formatShortDate } from "@/lib/client/format";
import { useLoad } from "@/lib/client/use-api";
import type { UserRole } from "@/lib/domain/enums";
import type { UserDto } from "@/lib/services/users";

export default function AdminUsersPage() {
    const { user } = useSession();
    const toast = useToast();
    const [f, setF] = useState({ q: "", role: "" });
    const [page, setPage] = useState(1);
    const [createOpen, setCreateOpen] = useState(false);
    const [deleting, setDeleting] = useState<UserDto | null>(null);
    const [resetOpen, setResetOpen] = useState(false);
    const [busy, setBusy] = useState<string | null>(null);
    const path = `/users${query({ ...f, page, pageSize: 10 })}`;
    const list = useLoad(() => apiPage<UserDto>(path), user.role === "admin" ? path : null);

    if (user.role !== "admin") return <EmptyState testId="admin-forbidden" title="Admins only" />;

    async function setRole(u: UserDto, role: UserRole) {
        setBusy(`role-${u.id}`);
        try {
            await patch(`/users/${u.id}`, { role });
            toast.success(`${u.displayName} is now ${role === "admin" ? "an admin" : "a user"}`);
            await list.reload();
        } catch (err) {
            toast.error(err);
        } finally {
            setBusy(null);
        }
    }

    async function remove() {
        if (!deleting) return;
        setBusy("delete");
        try {
            await del(`/users/${deleting.id}`);
            toast.success(`${deleting.displayName} deleted`);
            setDeleting(null);
            await list.reload();
        } catch (err) {
            toast.error(err);
        } finally {
            setBusy(null);
        }
    }

    async function resetDemo() {
        setBusy("reset");
        try {
            await post("/admin/reset");
            // Every account was recreated, including this one: sign in again
            window.location.href = "/login";
        } catch (err) {
            toast.error(err);
            setBusy(null);
        }
    }

    return (
        <>
            <PageHeader
                title="Users"
                subtitle="Manage accounts and roles."
                actions={
                    <>
                        <Button variant="secondary" onClick={() => setResetOpen(true)} testId="admin-reset-open">
                            Reset demo data
                        </Button>
                        <Button onClick={() => setCreateOpen(true)} testId="users-create-open">
                            + New user
                        </Button>
                    </>
                }
            />
            <div className="mb-4 flex flex-wrap gap-3">
                <Input
                    aria-label="Search"
                    placeholder="Search name or email"
                    className="w-64"
                    testId="users-search"
                    value={f.q}
                    onChange={(e) => {
                        setF({ ...f, q: e.target.value });
                        setPage(1);
                    }}
                />
                <Select
                    aria-label="Role"
                    className="w-36"
                    testId="users-role-filter"
                    value={f.role}
                    onChange={(e) => {
                        setF({ ...f, role: e.target.value });
                        setPage(1);
                    }}
                >
                    <option value="">Any role</option>
                    <option value="admin">Admin</option>
                    <option value="user">User</option>
                </Select>
            </div>

            {list.loading && !list.data ? (
                <Spinner />
            ) : list.error ? (
                <ErrorBanner error={list.error} onRetry={list.reload} />
            ) : (
                list.data && (
                    <Card>
                        <table className="w-full text-sm" data-testid="users-table">
                            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                                <tr>
                                    <th className="px-5 py-2 font-medium">Name</th>
                                    <th className="px-3 py-2 font-medium">Email</th>
                                    <th className="px-3 py-2 font-medium">Role</th>
                                    <th className="px-3 py-2 font-medium">Joined</th>
                                    <th className="px-5 py-2" />
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {list.data.data.map((u) => (
                                    <tr key={u.id} data-testid="user-row" data-user-id={u.id}>
                                        <td className="px-5 py-3 font-medium text-slate-900">
                                            {u.displayName} {u.id === user.id && <Badge tone="violet">you</Badge>}
                                        </td>
                                        <td className="px-3 py-3 text-slate-600" data-testid="user-email">
                                            {u.email}
                                        </td>
                                        <td className="px-3 py-3">
                                            <Select
                                                aria-label={`Role of ${u.displayName}`}
                                                className="w-28"
                                                testId="user-role"
                                                value={u.role}
                                                disabled={u.id === user.id || busy === `role-${u.id}`}
                                                onChange={(e) => setRole(u, e.target.value as UserRole)}
                                            >
                                                <option value="user">User</option>
                                                <option value="admin">Admin</option>
                                            </Select>
                                        </td>
                                        <td className="px-3 py-3 text-slate-500">{formatShortDate(u.createdAt)}</td>
                                        <td className="px-5 py-3 text-right">
                                            {u.id !== user.id && (
                                                <Button size="sm" variant="ghost" onClick={() => setDeleting(u)} testId="user-delete">
                                                    Delete
                                                </Button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <div className="px-5 pb-4">
                            <Pager page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
                        </div>
                    </Card>
                )
            )}

            <CreateUserModal
                open={createOpen}
                onClose={() => setCreateOpen(false)}
                onCreated={async () => {
                    setCreateOpen(false);
                    await list.reload();
                }}
            />

            <Modal
                open={!!deleting}
                title="Delete this user?"
                onClose={() => setDeleting(null)}
                testId="user-delete-modal"
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setDeleting(null)}>
                            Keep
                        </Button>
                        <Button variant="danger" loading={busy === "delete"} onClick={remove} testId="user-delete-confirm">
                            Delete
                        </Button>
                    </>
                }
            >
                <p className="text-sm text-slate-600">
                    {deleting?.displayName} ({deleting?.email}) will be removed. Users who run or play in a league can&apos;t be deleted.
                </p>
            </Modal>

            <Modal
                open={resetOpen}
                title="Reset all data?"
                onClose={() => setResetOpen(false)}
                testId="admin-reset-modal"
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setResetOpen(false)}>
                            Cancel
                        </Button>
                        <Button variant="danger" loading={busy === "reset"} onClick={resetDemo} testId="admin-reset-confirm">
                            Reset everything
                        </Button>
                    </>
                }
            >
                <p className="text-sm text-slate-600">
                    Deletes every account, league, entry and pick, then loads the demo data again. You&apos;ll be signed out; sign in with the demo admin account.
                </p>
            </Modal>
        </>
    );
}

function CreateUserModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => Promise<void> }) {
    const toast = useToast();
    const empty = { displayName: "", email: "", password: "", role: "user" as UserRole };
    const [form, setForm] = useState(empty);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState(false);

    async function submit() {
        setBusy(true);
        setErrors({});
        try {
            await post("/users", form);
            toast.success(`${form.displayName} created`);
            setForm(empty);
            await onCreated();
        } catch (err) {
            setErrors(fieldErrors(err));
            toast.error(err);
        } finally {
            setBusy(false);
        }
    }

    return (
        <Modal
            open={open}
            title="New user"
            onClose={onClose}
            testId="user-create-modal"
            footer={
                <>
                    <Button variant="secondary" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button loading={busy} onClick={submit} testId="user-create-submit">
                        Create
                    </Button>
                </>
            }
        >
            <div className="space-y-4">
                <Field label="Display name" htmlFor="nu-name" error={errors.displayName} testId="user-create-name">
                    <Input id="nu-name" testId="user-create-name" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
                </Field>
                <Field label="Email" htmlFor="nu-email" error={errors.email} testId="user-create-email">
                    <Input id="nu-email" testId="user-create-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </Field>
                <Field label="Password" htmlFor="nu-password" error={errors.password} testId="user-create-password">
                    <Input id="nu-password" testId="user-create-password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                </Field>
                <Field label="Role" htmlFor="nu-role" testId="user-create-role">
                    <Select id="nu-role" testId="user-create-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}>
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                    </Select>
                </Field>
            </div>
        </Modal>
    );
}
