import { cookies } from "next/headers";
import { getDb } from "@/lib/db/client";
import type { Actor } from "@/lib/services/context";
import { readSession, SESSION_COOKIE } from "./session";

/** The signed-in user in a server component (from the session cookie), or null. */
export async function getServerActor(): Promise<Actor | null> {
    const store = await cookies();
    const session = await readSession(getDb(), null, store.get(SESSION_COOKIE)?.value);
    return session.actor;
}
