# Module 0 — Foundation & Auth

Status: **delivered**. This module scaffolds the monorepo and ships authentication end-to-end (backend + frontend + validation + tests + docs).

## What's included
**Monorepo** — npm workspaces: `packages/shared`, `api` (NestJS), `web` (React 19 + Vite). Postgres via `docker-compose`.

**Shared (`packages/shared`)** — all domain enums + Zod contracts (`loginSchema`, `changePasswordSchema`, pagination, API envelopes) consumed by both API and Web.

**API (`api`)**
- Full Prisma schema (every module's tables) + first migration + seed (company, invoice settings, Owner user, Comptech VX1/VZ1/MARS models).
- `PrismaService` with soft-delete middleware; `AppConfigService` with Zod-validated env.
- `StorageService` seam + `LocalStorageService` (S3-ready); `ActivityLogService` (audit).
- Auth: `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`, `PATCH /auth/password`.
  - JWT access (15m) + refresh (7d, rotated, hashed at rest); bcrypt password hashing.
  - `JwtAuthGuard` (global, `@Public()` opt-out) → `ThrottlerGuard` → `RolesGuard` (`@Roles()`).
  - `AllExceptionsFilter` (Prisma-aware), `LoggingInterceptor`, `ZodValidationPipe`.
- `GET /health` (public) — liveness + DB check.

**Web (`web`)**
- Tailwind + brand tokens (Navy/Teal/Gold, Poppins), light/dark theme, shadcn primitives.
- App shell: sidebar (full module nav; unbuilt items show a disabled "Soon" state), topbar with theme toggle + user menu, mobile drawer.
- Axios client with automatic single-flight token refresh on 401.
- `AuthProvider` + route guards (`RequireAuth`, `RequireGuest`).
- Login page and Account page (view profile + working change-password), both fully functional.

## Permissions (enforced now, extended per module)
`JwtAuthGuard` protects everything except `@Public()` routes. `RolesGuard` reads `@Roles()`. Sidebar hides items by role via `visibleNavItems`.

## How to run
```bash
cd app
cp .env.example .env            # values already sensible for local dev
npm install
npm run db:up                   # start Postgres (docker)
npm run build --workspace packages/shared
npm run prisma:migrate --workspace api    # creates tables
npm run prisma:seed --workspace api       # company + owner + models
npm run dev                     # api :3000, web :5173
```
Log in at http://localhost:5173/login with `owner@azadev.in` / `Azad@12345` (from `.env`).

## How to test
```bash
npm test --workspace api        # unit: auth service, zod pipe
npm run test --workspace web    # unit: money helpers
# e2e (needs DB up + seeded):
npm run test:e2e --workspace api
```

## Verify checklist
- [ ] `GET /api/v1/health` returns `{ status: "ok", db: "up" }`.
- [ ] Login returns access + refresh tokens; `GET /auth/me` returns the Owner.
- [ ] Wrong password → 401; protected route without token → 401.
- [ ] Change password works; old password then fails, new one succeeds.
- [ ] Dark mode toggles and persists; sidebar shows "Soon" on unbuilt modules.

## Next
Module 1 — Dashboard (minimal: today's sales/collections, available inventory, pending deliveries/payments, service due, quick actions, recent activity, monthly sales chart).
