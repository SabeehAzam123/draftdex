# DraftDex: the rules

What DraftDex does, rule by rule: the spec the tests check. Each rule names the error code the API answers when it's broken. Written 2026-11-09 for version 0.2 (phase 1a: everything up to the end of the draft; matches, standings, trades and prize payouts come next).

## People and roles

| Who | Can |
| --- | --- |
| Anyone | Sign up, sign in, browse the Pokémon |
| Signed-in user | See every league, create one (and become its **commissioner**), apply to one (and become a **coach** once approved) |
| Commissioner | Change the league's rules and tier list before the draft, approve and reject coaches, start the draft, pick for the coach on the clock, skip a pick, cancel the league, set the Discord webhook |
| Admin | Everything a commissioner can do in every league, plus manage users and reset all data |

One person can run one league and play in another, or enter their own league. Signed-out requests get `401 AUTH_MISSING_TOKEN`; a bad, expired or orphaned token gets `401 AUTH_INVALID_TOKEN`; a missing right gets `403 RBAC_FORBIDDEN`.

## Accounts and credits

- Email is unique, case-insensitive (`409 USER_EMAIL_EXISTS`). Passwords need 8+ characters, a letter and a number. Sign-up always makes a normal user; unknown fields such as `role` are refused (`422 VALIDATION_ERROR`).
- A wrong password and an unknown email get the same answer (`401 AUTH_INVALID_CREDENTIALS`), so the API doesn't reveal which emails exist.
- Every account starts with **1,000 credits**. Credits are play money, held in a **double-entry ledger**: every movement writes two rows that cancel out, so the ledger always sums to zero.
- An admin can't change their own role or delete their own account (`409 USER_CANNOT_CHANGE_SELF`), and can't delete someone who runs or plays in a league (`409 USER_HAS_ACTIVITY`).

## A league's life

`setup → registration → drafting → season → completed`, plus `cancelled` from setup or registration. Each step is its own action; doing one in the wrong state gets `409 LEAGUE_INVALID_STATE` with a message saying why.

### Rules (settings)

| Setting | Default | Allowed |
| --- | --- | --- |
| Points budget | 100 | 10–500 |
| Roster size (= draft rounds) | 10 | 3–15 |
| Max coaches | 8 | 2–16 |
| Entry fee (credits) | 100 | 0–1000 |
| Pick timer | off | off, or 10 s – 24 h |
| Prize split | 60 / 30 / 10 | 1–3 places adding up to 100 |

Rules can change only in setup and registration. Once anyone has paid, **the entry fee is locked**, and the coach limit can't go below the number of applicants (`409 LEAGUE_SETTING_LOCKED`).

### Tier list (the pool)

- Every species gets a cost from its base stat total: ≥600 → 20 · 580–599 → 18 · 550–579 → 16 · 520–549 → 14 · 500–519 → 12 · 480–499 → 10 · 450–479 → 8 · 400–449 → 5 · 350–399 → 3 · below 350 → 1.
- Legendary and mythical Pokémon start **banned**.
- The commissioner can change costs (1–20) and bans in setup and registration. A batch of changes is all or nothing: one unknown Pokémon and nothing changes (`422 VALIDATION_ERROR`).
- CSV import: one line per Pokémon, `<dex number or name>,<points or banned>`, with an optional header and `#` comments. Every bad line is reported with its line number, and nothing changes unless all are valid (`422 POOL_IMPORT_INVALID`).

### Registration

- Coaches apply with a team name (3–40 characters) while registration is open. The entry fee is charged at once.
- Refused when: already applied (`409 ENTRY_ALREADY_EXISTS`); another active team has that name, any case (`409 ENTRY_TEAM_NAME_TAKEN`); applicants already fill the league (`409 ENTRY_LEAGUE_FULL`); not enough credits (`422 ENTRY_INSUFFICIENT_CREDITS`).
- The commissioner approves or rejects pending entries (`409 ENTRY_INVALID_STATE` otherwise). A coach can withdraw before the draft. A rejected or withdrawn coach may apply again and pays again.
- **Refunds return what was actually paid** (read from the ledger, not the current fee). Rejecting, withdrawing and cancelling the league all refund.

### Starting the draft

Needs at least 2 approved coaches (`409 LEAGUE_NOT_ENOUGH_COACHES`) and no pending applications (`409 ENTRY_PENDING_EXISTS`). The pool must let every coach always finish a roster: enough Pokémon at the cheapest cost for every slot, and a roster of them within budget (`409 LEAGUE_POOL_INFEASIBLE`). The order is random, or the commissioner lists every approved entry exactly once (`422 DRAFT_ORDER_INVALID`).

The draft is a **snake**: round 1 runs A, B, C; round 2 runs C, B, A; and so on, for as many rounds as the roster size.

### A pick

Only the coach on the clock, the commissioner or an admin may pick. Another coach in the league gets `409 DRAFT_NOT_YOUR_TURN`; anyone else gets `403`. A pick is refused when the Pokémon:

- isn't in the pool (`404 DRAFT_NOT_IN_POOL`);
- is banned (`409 DRAFT_POKEMON_BANNED`);
- is already drafted (`409 DRAFT_POKEMON_TAKEN`). If two picks for the same Pokémon arrive at once, exactly one wins;
- costs more than the **budget rule** allows (`422 DRAFT_OVER_BUDGET`). The most a pick may cost is the budget, minus points spent, minus the cheapest cost in the pool times the coach's open slots after this one. A coach can never strand themselves.

When the last slot is filled, the league moves to **season**.

### The timer

With a pick timer set, each slot gets a deadline when it becomes current; the next deadline counts from the moment a pick is made. When a deadline passes:

- a **regular** slot is skipped, and the coach gets a **makeup** slot at the end of the draft;
- a **makeup** slot auto-drafts the cheapest Pokémon that fits the budget (ties → lowest dex number), or is forfeited if nothing fits.

The clock is settled whenever anyone reads or writes the draft, so a long gap settles several slots at once. Missed deadlines chain from each other, not from when someone looked. The commissioner's **Skip this pick** does the same as a deadline passing, right now.

### Rosters and Showdown

Every team's roster is public to signed-in users. The Showdown export is one species per block, in Showdown's spelling (e.g. `Nidoran♀` → `Nidoran-F`).

## Discord notifications

- The commissioner sets a webhook URL. Only hosts in `WEBHOOK_ALLOWED_HOSTS` (default `discord.com`, `discordapp.com` and their subdomains) are accepted, over https. IP addresses and URLs with credentials are refused (`422 WEBHOOK_URL_NOT_ALLOWED`).
- The URL holds a secret token, so the API only ever shows it masked (`https://discord.com/api/webhooks/****`), and only to the commissioner.
- Events: coach approved, draft started, pick made, pick skipped, auto-pick, draft complete. They're sent after the response with a 3-second timeout, and only for changes that were saved. Each delivery is logged (sent / failed, HTTP status, a reason that never contains the URL).
- **Send test** posts a test message straight away and reports the outcome (`409 WEBHOOK_NOT_CONFIGURED` without a URL).

## Errors

Every error body is `{ message, code, traceId, details? }`. `details` lists field problems as `{ path, message }`. Writes without `Content-Type: application/json` get `415 UNSUPPORTED_MEDIA_TYPE`; a body that isn't JSON gets `400 BAD_REQUEST`. Unexpected failures get `500 INTERNAL_ERROR` with no internals, and are logged with the trace id. A busy database gets `503 CONFLICT_BUSY` with `Retry-After: 1`.
