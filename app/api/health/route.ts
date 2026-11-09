import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { APP_NAME } from "@/lib/config";
import { api } from "@/lib/http/handler";

/** GET /api/health: for CI and the test framework to wait on. 200 when the database answers. */
export const GET = api(
    async ({ ctx }) => {
        await ctx.db.run(sql`select 1`);
        return NextResponse.json({ status: "ok", app: APP_NAME });
    },
    { public: true },
);
