import bcrypt from "bcryptjs";

// Fewer rounds under test keeps the unit tests fast; real hashes use 10.
const ROUNDS = process.env.NODE_ENV === "test" ? 4 : 10;

export function hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, ROUNDS);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
}
