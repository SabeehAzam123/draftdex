import { notFound } from "@/lib/errors/app-error";
import { ErrorCodes } from "@/lib/errors/codes";
import { api, ok, readBody } from "@/lib/http/handler";
import { actOnTrade, type TradeAction } from "@/lib/services/trades";
import { EmptySchema } from "@/lib/validators/schemas";

const ACTIONS: TradeAction[] = ["accept", "decline", "cancel", "approve", "reject"];

/**
 * POST /api/leagues/:id/trades/:tradeId/<action>
 * accept / decline: the coach receiving the offer · cancel: the proposer · approve / reject: the commissioner
 */
export const POST = api<{ id: string; tradeId: string; action: string }>(async ({ req, params, ctx }) => {
    if (!ACTIONS.includes(params.action as TradeAction)) throw notFound(ErrorCodes.NOT_FOUND, `No trade action "${params.action}"`);
    await readBody(req, EmptySchema);
    return ok(await actOnTrade(ctx, params.id, params.tradeId, params.action as TradeAction));
});
