import { redirect } from "next/navigation";
import { getServerActor } from "@/lib/auth/server";

export default async function Home() {
    redirect((await getServerActor()) ? "/leagues" : "/login");
}
