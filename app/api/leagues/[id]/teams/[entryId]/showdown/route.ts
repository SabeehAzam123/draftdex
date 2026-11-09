import { NextResponse } from "next/server";
import { api } from "@/lib/http/handler";
import { getShowdownExport } from "@/lib/services/teams";

/** GET /api/leagues/:id/teams/:entryId/showdown: the roster as Pokémon Showdown import text (text/plain). */
export const GET = api<{ id: string; entryId: string }>(
    async ({ params, ctx }) =>
        new NextResponse(await getShowdownExport(ctx, params.id, params.entryId), {
            headers: { "content-type": "text/plain; charset=utf-8" },
        }),
);
