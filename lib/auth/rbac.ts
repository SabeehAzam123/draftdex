export type Role = "Admin" | "Staff";

export function requireRole(userRole: Role, allowed: Role[]) {
    return allowed.includes(userRole);
}
