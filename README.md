# DraftDex

**Run a Pokémon draft league in one place.** Coaches join a league, pay an entry fee in credits, draft Pokémon in a snake draft on a points budget, play a round-robin season, trade, and split the prize pool. The commissioner sets the tier list, runs the draft and settles disputes. Rosters export straight into Pokémon Showdown.

DraftDex is also the **app under test** for [draftdex-qa-framework](https://github.com/SabeehAzam123/draftdex-qa-framework), a Playwright + TypeScript framework, and a practice ground for manual testers learning automation. It has real rules to break: a budget that must always leave room to finish a roster, a timer that skips and auto-picks, a double-entry ledger, roles and permissions, and a webhook guarded against misuse.

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript (strict) · SQLite via libSQL + Drizzle ORM · Zod · jose (JWT) · Tailwind CSS 4 · Vitest

## What it does

- **Leagues** move through *setup → registration → draft → season → completed*. Anyone can start one and becomes its commissioner.
- **Tier list:** every one of the 1,025 species gets a cost (1–20 points) from its base stats, with legendaries and mythicals banned by default. The commissioner edits it inline or imports a CSV, all or nothing.
- **Registration:** coaches apply with a team name and pay the entry fee from their credits (everyone starts with 1,000). The commissioner approves or rejects. Rejecting, withdrawing or cancelling the league refunds what was paid.
- **Snake draft** (round 1 A→Z, round 2 Z→A, …) with a points budget. **A pick is refused if it would leave you unable to fill your roster** with the cheapest Pokémon left in the pool. Two coaches clicking the same Pokémon at the same moment: exactly one gets it.
- **Draft timer + auto-skip:** a missed pick moves to the end of the draft as a makeup pick. A missed makeup pick auto-drafts the cheapest Pokémon that fits. The commissioner can also skip a pick.
- **Season:** when the draft ends, every team gets a match against every other team (round robin, home games spread evenly). Best of three.
- **Results:** a coach reports the score, optionally with a **Showdown replay link**. The opponent confirms or disputes; the commissioner settles disputes (or any match). A coach can't confirm their own report.
- **Standings:** wins, then game difference, then head-to-head, with the prize each place would win right now.
- **Trades:** 1-for-1 up to 3-for-3. The other coach accepts, the commissioner approves; both teams must stay within budget, and a trade whose Pokémon moved meanwhile can't be approved. The draft record keeps who drafted what.
- **Completing the season** pays the prize pool out by the league's split. Rounding leftovers, and the shares of places no team can take, go to 1st, so the pool is always paid out exactly.
- **Showdown export:** copy any roster as Pokémon Showdown import text.
- **Discord notifications:** approvals, the draft, every pick, results, disputes, approved trades and the champion post to a channel's webhook. The webhook URL is never shown back in full, and only allowed hosts can be called.
- **Wallet:** every credit movement is a double-entry ledger row, so the whole ledger always sums to zero.
- **Admin:** manage users and roles, and reset all data back to the demo data in one click.

## Run it

**Needs:** Node.js 22+ (developed on 25). No database to install.

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. The first run creates `data/draftdex.db`, loads the Pokémon, and adds demo data:

| Account | Password | |
| --- | --- | --- |
| `admin@draftdex.test` | `Admin123!` | Admin |
| `coach1@draftdex.test` … `coach8@draftdex.test` | `Coach123!` | Coaches |

These are local demo accounts only. The demo has one league in each state: **Weekend Cup** (being set up), **Sunday Singles S1** (registration, one coach waiting for approval), **Office League S3** (mid-draft: `coach3` is on the clock), **Friends Doubles S2** (in its season: a confirmed result, one waiting for confirmation, and a trade offer) and **Pilot League S0** (completed and paid out).

`npm run db:reset` (or *Admin → Reset demo data*) puts everything back. Settings are optional: see [`.env.example`](.env.example).

| Command | What it does |
| --- | --- |
| `npm run dev` | Prepares the database, then starts the app |
| `npm test` | All unit and API tests (Vitest) |
| `npm run test:coverage` | The same, with a coverage report (`coverage/index.html`) |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm run db:reset` | Deletes all data and loads the demo data again |
| `npm run db:generate` | Writes a new migration after a change to `lib/db/schema.ts` |
| `npm run pokemon:fetch` | Refreshes `data/pokemon.json` from PokéAPI |

## Tests

**207 tests, ~14 s, 98 % of statements and 89 % of branches covered** (`npm run test:coverage`). Each test file gets its own SQLite database, so files run in parallel.

- **Rules** (`lib/domain/*.test.ts`): tiers, snake order, the budget rule, pool feasibility, Showdown names, webhook URL checks, CSV parsing. No database.
- **Services** (`lib/services/*.test.ts`): every rule against a real database. Who may do what, refunds, the ledger summing to zero, the timer (with an injected clock), the simultaneous-pick race, and "a rolled-back pick announces nothing".
- **API** (`test/api/*.test.ts`): the real route handlers over HTTP. Status codes, error bodies, the session cookie's flags, 401/403/415/400/422, and a league from creation to a finished draft.

The end-to-end tests (browser and API, against the running app) live in the test framework repo.

## API

JSON in and out. Successes are `{ data }`; lists are `{ data, page, pageSize, total }`. **Errors are always `{ message, code, traceId, details? }`**, with stable codes such as `DRAFT_OVER_BUDGET`, `ENTRY_LEAGUE_FULL` and `RBAC_FORBIDDEN`. Every response carries an `x-trace-id` header. Writes need `Content-Type: application/json`. Send `Authorization: Bearer <token>` from `POST /api/auth/login`; the browser uses an httpOnly cookie instead.

| Method & path | Who |
| --- | --- |
| `POST /api/auth/signup` · `/login` · `/logout` | anyone |
| `GET /api/health` · `GET /api/pokemon` · `GET /api/pokemon/:id` | anyone |
| `GET\|PATCH /api/me` · `GET /api/me/wallet` | signed in |
| `GET\|POST /api/leagues` · `GET /api/leagues/:id` | signed in |
| `PATCH /api/leagues/:id` · `POST …/open-registration` · `…/cancel` · `…/start-draft` | commissioner |
| `GET /api/leagues/:id/pool` (+ `/summary`) · `PUT …/pool` · `POST …/pool/import` | all / commissioner |
| `GET\|POST /api/leagues/:id/entries` · `POST …/entries/:entryId/approve\|reject\|withdraw` | all / commissioner / that coach |
| `GET /api/leagues/:id/draft` · `POST …/draft/picks` · `POST …/draft/skip` | all / coach on the clock or commissioner / commissioner |
| `GET /api/leagues/:id/teams/:entryId` (+ `/showdown`, text) | signed in |
| `GET /api/leagues/:id/schedule` · `GET …/matches/:matchId` · `GET …/standings` | signed in |
| `POST …/matches/:matchId/report` · `…/confirm` · `…/dispute` | the two coaches in the match |
| `POST …/matches/:matchId/resolve` · `POST /api/leagues/:id/complete` | commissioner |
| `GET\|POST /api/leagues/:id/trades` · `POST …/trades/:tradeId/accept\|decline\|cancel\|approve\|reject` | all / coaches / receiver / proposer / commissioner |
| `PUT /api/leagues/:id/webhook` · `POST …/webhook/test` · `GET …/notifications` | commissioner |
| `GET\|POST /api/users` · `PATCH\|DELETE /api/users/:id` · `POST /api/admin/reset` | admin |

The full rules are in [docs/PRODUCT.md](docs/PRODUCT.md).

## How it's built

```text
app/
├── (auth)/              Sign-in and sign-up pages
├── (app)/               The signed-in app: leagues (overview, tier list, draft, team, settings), Pokémon, wallet, admin
└── api/                 Route handlers: parse input, call a service, return JSON
lib/
├── domain/              Pure rules (no database): tiers, draft order and budget, Showdown text, webhook checks, CSV
├── services/            The rules against the database, plus their tests
├── db/                  Drizzle schema, client (write queue), migrations runner
├── http/handler.ts      Every route's wrapper: auth, trace id, JSON-only writes, error shape, notifications after the response
├── validators/          Zod schemas for every body and query
├── auth/                JWT, password hashing, session cookie
└── client/              Browser API client and hooks
components/              UI kit, app shell, shared forms
drizzle/                 SQL migrations (committed)
data/pokemon.json        1,025 species from PokéAPI (committed; the app needs no network)
test/                    Test setup, helpers, API tests
```

- **The browser always goes through the API.** Pages are client components that call `/api/...`, so every user action is a real HTTP request a test can watch and check.
- **Every interactive element has a `data-testid`**, in kebab case, named by area: `login-email`, `league-start-draft`, `draft-pick-button` (with `data-pokemon-id`), `entry-row` (with `data-entry-id` and `data-status`), `toast` (with `data-type`). Error toasts and banners show the API's trace id, so a bug report can point at the exact request.
- **Writes queue in the app.** The local SQLite driver is synchronous, so two writers waiting on SQLite's lock would block Node's only thread. Write transactions run one at a time in-process instead ([`lib/db/client.ts`](lib/db/client.ts)).
- **The draft timer is lazy:** no background job. Each read or write of the draft first settles any picks whose time ran out, so it also works on serverless hosting.

## Credits

Pokémon data and sprites come from [PokéAPI](https://pokeapi.co). DraftDex is a fan project, not affiliated with Nintendo, Game Freak or The Pokémon Company.
