import { api, ok } from "@/lib/http/handler";
import { getWallet } from "@/lib/services/users";

/** GET /api/me/wallet: balance and the latest ledger rows. */
export const GET = api(async ({ ctx }) => ok(await getWallet(ctx)));
