import { api, ok, readBody } from "@/lib/http/handler";
import { requireAdmin } from "@/lib/services/context";
import { clearData, seedDemo } from "@/lib/services/seed";
import { EmptySchema } from "@/lib/validators/schemas";

/** POST /api/admin/reset (admin): deletes everything and loads the demo data again. */
export const POST = api(async ({ req, ctx }) => {
    requireAdmin(ctx);
    await readBody(req, EmptySchema);
    await clearData(ctx.db);
    return ok(await seedDemo(ctx.db));
});
