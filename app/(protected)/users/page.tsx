"use client";

import React, { useEffect, useState } from "react";
import { getUser, type SessionUser } from "@/lib/client/authStore";
import { apiDelete, apiGet, apiPost, apiPut, type ApiError } from "@/lib/client/api";
import { Toast } from "@/components/ui/Toast";
import { Modal } from "@/components/ui/Modal";

type UserRow = { id: string; email: string; role: "Admin" | "Staff"; createdAt: string };
type UsersResponse = { data: UserRow[]; page: number; pageSize: number; total: number };

export default function UsersPage() {
    // -------------------------
    // Hooks (always run in same order)
    // -------------------------
    const [me, setMe] = useState<SessionUser | null>(null);

    const [loading, setLoading] = useState(false);
    const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

    const [rows, setRows] = useState<UserRow[]>([]);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [total, setTotal] = useState(0);

    const [roleFilter, setRoleFilter] = useState<"" | "Admin" | "Staff">("");

    // Search UX: "q" is the input box, "searchApplied" is what we actually send to API.
    const [q, setQ] = useState("");
    const [searchApplied, setSearchApplied] = useState("");

    // Modals
    const [createOpen, setCreateOpen] = useState(false);
    const [editOpen, setEditOpen] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);

    const [active, setActive] = useState<UserRow | null>(null);

    // Form state
    const [formEmail, setFormEmail] = useState("");
    const [formPassword, setFormPassword] = useState("");
    const [formRole, setFormRole] = useState<"Admin" | "Staff">("Staff");

    const [emailErr, setEmailErr] = useState<string | null>(null);
    const [passErr, setPassErr] = useState<string | null>(null);

    const isAdmin = me?.role === "Admin";

    // -------------------------
    // Session bootstrapping (client only)
    // -------------------------
    useEffect(() => {
        const u = getUser();
        if (!u) {
            window.location.href = "/login";
            return;
        }
        setMe(u);
    }, []);

    // -------------------------
    // Data load
    // -------------------------
    async function load() {
        // Avoid calling API before auth is ready
        if (!me) return;

        setLoading(true);
        setToast(null);

        const params = new URLSearchParams();
        params.set("page", String(page));
        params.set("pageSize", String(pageSize));
        if (roleFilter) params.set("role", roleFilter);
        if (searchApplied.trim()) params.set("q", searchApplied.trim());

        try {
            const res = (await apiGet(`/users?${params.toString()}`)) as UsersResponse;
            setRows(res.data);
            setTotal(res.total);
        } catch (err: any) {
            const apiErr = err as ApiError;
            setToast({ type: "error", message: apiErr?.message || "Failed to load users" });
        } finally {
            setLoading(false);
        }
    }

    // Load users only AFTER me is set, and whenever paging/filter/applied-search changes
    useEffect(() => {
        if (!me) return;
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [me, page, pageSize, roleFilter, searchApplied]);

    // -------------------------
    // Guards (AFTER hooks)
    // -------------------------
    if (!me) {
        return (
            <div data-testid="users-auth-loading" style={{ padding: 16 }}>
                Loading...
            </div>
        );
    }

    // -------------------------
    // Validation helpers
    // -------------------------
    function resetErrors() {
        setEmailErr(null);
        setPassErr(null);
    }

    function validateCreate() {
        resetErrors();
        let ok = true;

        if (!formEmail.trim()) {
            setEmailErr("Email is required");
            ok = false;
        } else if (!/^\S+@\S+\.\S+$/.test(formEmail.trim())) {
            setEmailErr("Email is invalid");
            ok = false;
        }

        if (!formPassword.trim()) {
            setPassErr("Password is required");
            ok = false;
        } else if (formPassword.trim().length < 6) {
            setPassErr("Password must be at least 6 characters");
            ok = false;
        }

        return ok;
    }

    function validateEdit() {
        resetErrors();
        let ok = true;

        if (!formEmail.trim()) {
            setEmailErr("Email is required");
            ok = false;
        } else if (!/^\S+@\S+\.\S+$/.test(formEmail.trim())) {
            setEmailErr("Email is invalid");
            ok = false;
        }

        return ok;
    }

    // -------------------------
    // CRUD actions
    // -------------------------
    async function onCreate() {
        if (!validateCreate()) return;

        try {
            await apiPost("/users", { email: formEmail, password: formPassword, role: formRole });
            setToast({ type: "success", message: "User created" });

            setCreateOpen(false);
            setFormEmail("");
            setFormPassword("");
            setFormRole("Staff");

            await load();
        } catch (err: any) {
            const apiErr = err as ApiError;
            setToast({ type: "error", message: apiErr?.message || "Create failed" });
        }
    }

    async function onEdit() {
        if (!active) return;
        if (!validateEdit()) return;

        try {
            await apiPut(`/users/${active.id}`, { email: formEmail, role: formRole });
            setToast({ type: "success", message: "User updated" });

            setEditOpen(false);
            setActive(null);

            await load();
        } catch (err: any) {
            const apiErr = err as ApiError;
            setToast({ type: "error", message: apiErr?.message || "Update failed" });
        }
    }

    async function onDelete() {
        if (!active) return;

        try {
            await apiDelete(`/users/${active.id}`);
            setToast({ type: "success", message: "User deleted" });

            setDeleteOpen(false);
            setActive(null);

            await load();
        } catch (err: any) {
            const apiErr = err as ApiError;
            setToast({ type: "error", message: apiErr?.message || "Delete failed" });
        }
    }

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    // -------------------------
    // UI
    // -------------------------
    return (
        <div style={{ maxWidth: 1100, margin: "40px auto", padding: 16 }}>
            <h1 data-testid="users-title">Users</h1>

            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <input
                    data-testid="users-search"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search by email..."
                    style={{ padding: 10, width: 260 }}
                />

                <button
                    data-testid="users-search-btn"
                    onClick={() => {
                        // Apply search & go to page 1. Effect will re-load reliably even if already on page 1.
                        setPage(1);
                        setSearchApplied(q);
                    }}
                >
                    Search
                </button>

                <button
                    data-testid="users-clear-search-btn"
                    onClick={() => {
                        setQ("");
                        setPage(1);
                        setSearchApplied("");
                    }}
                >
                    Clear
                </button>

                <select
                    data-testid="role-filter"
                    value={roleFilter}
                    onChange={(e) => {
                        setPage(1);
                        setRoleFilter(e.target.value as any);
                    }}
                    style={{ padding: 10 }}
                >
                    <option value="">All roles</option>
                    <option value="Admin">Admin</option>
                    <option value="Staff">Staff</option>
                </select>

                <select
                    data-testid="page-size"
                    value={pageSize}
                    onChange={(e) => {
                        setPage(1);
                        setPageSize(Number(e.target.value));
                    }}
                    style={{ padding: 10 }}
                >
                    <option value={5}>5</option>
                    <option value={10}>10</option>
                    <option value={20}>20</option>
                </select>

                <button
                    data-testid="create-user-btn"
                    disabled={!isAdmin}
                    onClick={() => {
                        setFormEmail("");
                        setFormPassword("");
                        setFormRole("Staff");
                        resetErrors();
                        setCreateOpen(true);
                    }}
                >
                    Create User
                </button>

                {!isAdmin && (
                    <span data-testid="rbac-hint" style={{ color: "#666" }}>
            Staff has read-only access
          </span>
                )}
            </div>

            <div style={{ marginTop: 16 }}>
                {loading ? (
                    <div data-testid="users-loading">Loading...</div>
                ) : (
                    <table data-testid="users-table" style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                        <tr>
                            <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 10 }}>Email</th>
                            <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 10 }}>Role</th>
                            <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 10 }}>Created</th>
                            <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 10 }}>Actions</th>
                        </tr>
                        </thead>
                        <tbody>
                        {rows.map((u) => (
                            <tr data-testid={`user-row-${u.id}`} key={u.id}>
                                <td style={{ borderBottom: "1px solid #eee", padding: 10 }}>{u.email}</td>
                                <td style={{ borderBottom: "1px solid #eee", padding: 10 }}>{u.role}</td>
                                <td style={{ borderBottom: "1px solid #eee", padding: 10 }}>
                                    {new Date(u.createdAt).toLocaleString()}
                                </td>
                                <td style={{ borderBottom: "1px solid #eee", padding: 10 }}>
                                    <button
                                        data-testid={`edit-user-btn-${u.id}`}
                                        disabled={!isAdmin}
                                        onClick={() => {
                                            setActive(u);
                                            setFormEmail(u.email);
                                            setFormRole(u.role);
                                            resetErrors();
                                            setEditOpen(true);
                                        }}
                                        style={{ marginRight: 8 }}
                                    >
                                        Edit
                                    </button>

                                    <button
                                        data-testid={`delete-user-btn-${u.id}`}
                                        disabled={!isAdmin}
                                        onClick={() => {
                                            setActive(u);
                                            setDeleteOpen(true);
                                        }}
                                    >
                                        Delete
                                    </button>
                                </td>
                            </tr>
                        ))}

                        {rows.length === 0 && (
                            <tr>
                                <td colSpan={4} style={{ padding: 10 }}>
                                    <div data-testid="users-empty">No results</div>
                                </td>
                            </tr>
                        )}
                        </tbody>
                    </table>
                )}
            </div>

            <div style={{ marginTop: 16, display: "flex", gap: 10, alignItems: "center" }}>
                <button data-testid="prev-page" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    Prev
                </button>

                <div data-testid="page-indicator">
                    Page {page} / {totalPages} (Total: {total})
                </div>

                <button data-testid="next-page" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                    Next
                </button>
            </div>

            {/* CREATE MODAL */}
            <Modal title="Create User" open={createOpen} onClose={() => setCreateOpen(false)} testId="create-user-modal">
                <div>
                    <label>
                        Email
                        <input
                            data-testid="create-email"
                            value={formEmail}
                            onChange={(e) => setFormEmail(e.target.value)}
                            style={{ width: "100%", padding: 10, marginTop: 6, marginBottom: 6 }}
                        />
                    </label>
                    {emailErr && (
                        <div data-testid="create-email-error" style={{ color: "crimson", marginBottom: 10 }}>
                            {emailErr}
                        </div>
                    )}

                    <label>
                        Password
                        <input
                            data-testid="create-password"
                            type="password"
                            value={formPassword}
                            onChange={(e) => setFormPassword(e.target.value)}
                            style={{ width: "100%", padding: 10, marginTop: 6, marginBottom: 6 }}
                        />
                    </label>
                    {passErr && (
                        <div data-testid="create-password-error" style={{ color: "crimson", marginBottom: 10 }}>
                            {passErr}
                        </div>
                    )}

                    <label>
                        Role
                        <select
                            data-testid="create-role"
                            value={formRole}
                            onChange={(e) => setFormRole(e.target.value as any)}
                            style={{ width: "100%", padding: 10, marginTop: 6, marginBottom: 6 }}
                        >
                            <option value="Admin">Admin</option>
                            <option value="Staff">Staff</option>
                        </select>
                    </label>

                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 12 }}>
                        <button data-testid="create-cancel" onClick={() => setCreateOpen(false)}>
                            Cancel
                        </button>
                        <button data-testid="create-submit" onClick={onCreate}>
                            Create
                        </button>
                    </div>
                </div>
            </Modal>

            {/* EDIT MODAL */}
            <Modal title="Edit User" open={editOpen} onClose={() => setEditOpen(false)} testId="edit-user-modal">
                <div>
                    <label>
                        Email
                        <input
                            data-testid="edit-email"
                            value={formEmail}
                            onChange={(e) => setFormEmail(e.target.value)}
                            style={{ width: "100%", padding: 10, marginTop: 6, marginBottom: 6 }}
                        />
                    </label>
                    {emailErr && (
                        <div data-testid="edit-email-error" style={{ color: "crimson", marginBottom: 10 }}>
                            {emailErr}
                        </div>
                    )}

                    <label>
                        Role
                        <select
                            data-testid="edit-role"
                            value={formRole}
                            onChange={(e) => setFormRole(e.target.value as any)}
                            style={{ width: "100%", padding: 10, marginTop: 6, marginBottom: 6 }}
                        >
                            <option value="Admin">Admin</option>
                            <option value="Staff">Staff</option>
                        </select>
                    </label>

                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 12 }}>
                        <button data-testid="edit-cancel" onClick={() => setEditOpen(false)}>
                            Cancel
                        </button>
                        <button data-testid="edit-submit" onClick={onEdit}>
                            Save
                        </button>
                    </div>
                </div>
            </Modal>

            {/* DELETE MODAL */}
            <Modal title="Delete User" open={deleteOpen} onClose={() => setDeleteOpen(false)} testId="delete-user-modal">
                <div data-testid="delete-confirm-text">
                    Are you sure you want to delete <b>{active?.email}</b>?
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 12 }}>
                    <button data-testid="delete-cancel" onClick={() => setDeleteOpen(false)}>
                        Cancel
                    </button>
                    <button data-testid="delete-confirm" onClick={onDelete}>
                        Delete
                    </button>
                </div>
            </Modal>

            {toast && <Toast type={toast.type} message={toast.message} />}
        </div>
    );
}
