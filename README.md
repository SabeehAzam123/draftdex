# mini-admin-panel-reference

A small **Next.js + MongoDB** admin app with **JWT authentication** ([jose](https://github.com/panva/jose)) and **role-based access control** (Admin / Staff). It is the app under test for **[Testing-Framework-A](https://github.com/SabeehAzam123/Testing-Framework-A)**: small enough to understand in a few minutes, with the things real apps need tested (auth, permissions, CRUD, validation and consistent error responses).

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript · MongoDB + Mongoose · jose · bcryptjs · Zod

## What's in it

- **Login:** `POST /api/auth/login` checks the bcrypt-hashed password and returns a signed JWT (HS256) carrying the user's id, email and role.
- **Users:** list (search by email, filter by role, paginate), create, edit and delete, as a REST API and as a UI page with modals.
- **RBAC:** any signed-in user can list users; only Admins can create, update or delete. The API answers Staff with `403 RBAC_FORBIDDEN`, and the UI disables those buttons and shows a hint.
- **Validation:** request bodies and query parameters are parsed with Zod; invalid input gets `422 VALIDATION_ERROR`.
- **Consistent errors:** error responses share one shape, `{ message, code, traceId }`, with stable codes such as `AUTH_INVALID_CREDENTIALS`, `RBAC_FORBIDDEN` and `USER_EMAIL_EXISTS`.
- **Built for testing:** interactive elements carry `data-testid` attributes, so tests don't depend on CSS classes or copy.

## API

| Method | Path | Allowed roles | Success |
|---|---|---|---|
| `POST` | `/api/auth/login` | anyone | `200` with `{ data: { token, user } }` |
| `GET` | `/api/users?page=&pageSize=&role=&q=` | Admin, Staff | `200` with `{ data, page, pageSize, total }` |
| `POST` | `/api/users` | Admin | `201` with the created user |
| `PUT` | `/api/users/:id` | Admin | `200` with the updated user |
| `DELETE` | `/api/users/:id` | Admin | `204` |

The `/api/users` routes need an `Authorization: Bearer <token>` header and return `401` without a valid token.

## Setup

**Prerequisites:** Node.js 20.9+ and a MongoDB database (local or Atlas).

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.env.local` in the project root:

   ```bash
   MONGO_URI=mongodb://localhost:27017/mini-admin-panel
   JWT_SECRET=replace-with-a-long-random-string
   JWT_EXPIRES_IN=30m
   NEXT_PUBLIC_API_BASE=/api
   ```

   `MONGO_URI` and `JWT_SECRET` are required. `JWT_EXPIRES_IN` defaults to `30m` and `NEXT_PUBLIC_API_BASE` to `/api`.

3. Seed the test accounts:

   ```bash
   npm run seed
   ```

   This recreates `admin@test.com` / `Admin123!` (Admin) and `staff@test.com` / `Staff123!` (Staff), and adds 25 Staff users so the list has pages to step through.

4. Start the app:

   ```bash
   npm run dev
   ```

   Open http://localhost:3000 and sign in with a seeded account.

To run the end-to-end tests against it, see [Testing-Framework-A](https://github.com/SabeehAzam123/Testing-Framework-A#running-the-tests).

## Project layout

```text
app/
├── (public)/login/           Login page
├── (protected)/dashboard/    Dashboard: shows the signed-in role, links to Users
├── (protected)/users/        Users page: search, filter, paginate, create / edit / delete
└── api/                      Route handlers: auth/login, users, users/[id]
lib/
├── auth/                     JWT sign and verify (jose), Bearer-token check, role check
├── validators/               Zod request schemas
├── errors/                   Error codes and the { message, code, traceId } helper
├── db/                       Cached Mongoose connection
└── client/                   Browser-side API client and localStorage session helpers
models/User.ts                Mongoose user model
scripts/seed.ts               Seeds the test accounts
```
