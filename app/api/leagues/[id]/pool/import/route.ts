import { api, ok, readBody } from "@/lib/http/handler";
import { importPoolCsv } from "@/lib/services/pool";
import { PoolImportSchema } from "@/lib/validators/schemas";

/** POST /api/leagues/:id/pool/import (commissioner): `{ csv: "dex,points\n445,18\nMewtwo,banned" }`. All or nothing. */
export const POST = api<{ id: string }>(async ({ req, params, ctx }) => {
    const body = await readBody(req, PoolImportSchema);
    return ok(await importPoolCsv(ctx, params.id, body.csv));
});
