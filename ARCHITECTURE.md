# Architecture — AZAD EV POINT

Single-showroom operations app. One backend (NestJS), one frontend (React), one shared contract package, one Postgres database. No multi-tenancy, no SaaS layer.

```
Browser ──HTTP/JSON──► NestJS API ──Prisma──► PostgreSQL
   React 19            (feature modules)        (single DB)
   React Query          JWT auth guards
   React Router         Zod validation
                        local file storage (S3-ready)
```

## 1. Monorepo layout
```
app/
├── packages/shared/   enums + Zod schemas + API/DTO types (built with tsup → ESM+CJS)
├── api/               NestJS backend
│   ├── prisma/        schema.prisma · migrations · seed.ts
│   └── src/
│       ├── common/    decorators · guards · filters · interceptors · pipes · types
│       ├── config/    Zod-validated env + typed AppConfigService
│       ├── prisma/    PrismaService (soft-delete middleware)
│       ├── storage/   StorageService seam + LocalStorageService (S3-ready)
│       ├── activity-log/ audit writer
│       ├── users/ · auth/ · health/   feature modules
│       └── main.ts    bootstrap (helmet, CORS, Swagger, BigInt JSON)
└── web/               React frontend
    └── src/
        ├── app/       providers (QueryClient, Theme, Auth)
        ├── components/ ui (shadcn) · layout · brand · common
        ├── features/  auth · account   (feature-sliced: api.ts, *-context, pages)
        ├── lib/       api-client · token-store · money · utils · labels
        └── router.tsx role-guarded route tree
```

`@azad/shared` is the single source of truth for enums and request/response contracts, imported by both API and Web — no drift between client and server.

## 2. Backend layering (per feature module)
`Controller` (thin, HTTP + validation) → `Service` (business logic, transactions) → `Repository` (Prisma access). DTOs are Zod schemas from `@azad/shared`, applied with `ZodValidationPipe`. Cross-cutting concerns live in `common/` and are wired globally in `app.module.ts`.

**Request lifecycle**
```
JwtAuthGuard (skip if @Public)
  → ThrottlerGuard (rate limit)
  → RolesGuard (@Roles)
  → ZodValidationPipe (per-arg body/query)
  → Controller → Service (→ Prisma, in a $transaction for multi-row writes)
  → LoggingInterceptor (method, path, user, ms)
  → AllExceptionsFilter (on error → consistent envelope)
```

## 3. Consistent error contract
Every error (HTTP, Prisma, validation) is normalised by `AllExceptionsFilter` into one shape (also exported as `ApiError` in `@azad/shared`):
```json
{
  "statusCode": 400,
  "error": "BAD_REQUEST",
  "message": "Validation failed",
  "details": [{ "path": "email", "message": "Invalid email" }],
  "path": "/api/v1/auth/login",
  "timestamp": "2026-07-23T00:00:00.000Z"
}
```
- Validation (Zod) → `400` with `details[]` of `{ path, message }`.
- Unique conflict (Prisma P2002) → `409`. Not found (P2025) → `404`. FK (P2003) → `400`.
- Auth failures → `401`; role failures → `403`. Unexpected → `500` (stack logged, never leaked).

## 4. Auth & security
- JWT **access** (15m) + **refresh** (7d). Refresh tokens are rotated on every use and stored only as a bcrypt hash on the user row; logout clears it.
- Passwords hashed with bcrypt (cost 12). `JwtStrategy` re-checks the user is active on every request.
- `helmet`, CORS locked to `WEB_ORIGIN`, global rate limiting via `@nestjs/throttler`.
- Frontend stores tokens in `localStorage` and refreshes transparently on `401` (single-flight in `api-client.ts`).

## 4b. Multi-tenancy (single-tenant-ready)
`Company` is the tenant root; every business table carries `companyId`. A request's company is bound into an `AsyncLocalStorage` `TenantContext` by `TenantInterceptor` (from the JWT), and the Prisma middleware auto-scopes every read/create/aggregate to it — tenant filtering lives in one place, not in each query. Raw SQL (Dashboard) passes `companyId` explicitly. Storage and audit logs are company-scoped. One company today; adding more needs no schema change. Full detail: [docs/PLATFORM-FOUNDATION.md](docs/PLATFORM-FOUNDATION.md).

## 5. Data & money
- PostgreSQL via Prisma. Every table carries `createdById`, `updatedById`, `createdAt`, `updatedAt`; soft-deletable tables carry `deletedAt` (filtered by `PrismaService` middleware).
- **Money is integer paise** (`BigInt`) everywhere. `BigInt.prototype.toJSON` is patched to serialise as a string; the web `money.ts` helpers convert only at the UI edge.

## 6. Storage (S3-ready seam)
`StorageService` interface + `STORAGE_SERVICE` token. `LocalStorageService` is the only implementation today (writes under `STORAGE_LOCAL_DIR`, guards against path traversal). Swapping to S3 = add an `S3StorageService` and branch in `storage.module.ts`; callers are unchanged.

## 7. Future-ready seams (interfaces only, not implemented)
- **Notifications** — in-app only now; a `NotificationChannel` interface will admit WhatsApp/SMS/Email later.
- **Cloud backup** — local SQL dump now; a `BackupTarget` seam for cloud later.
- **Mobile app** — the stateless REST API is the single source of truth, ready for a future React Native client.

## 8. Environment variables
Validated at boot by `api/src/config/env.ts` (app refuses to start on invalid config). Template: [`.env.example`](.env.example).

| Variable | Scope | Required | Default | Purpose |
|---|---|---|---|---|
| `DATABASE_URL` | api | ✅ | — | Postgres connection string |
| `API_PORT` | api | — | `3000` | API listen port |
| `NODE_ENV` | api | — | `development` | `development` \| `test` \| `production` |
| `JWT_ACCESS_SECRET` | api | ✅ (≥16 chars) | — | Access-token signing secret |
| `JWT_ACCESS_TTL` | api | — | `15m` | Access-token lifetime |
| `JWT_REFRESH_SECRET` | api | ✅ (≥16 chars) | — | Refresh-token signing secret |
| `JWT_REFRESH_TTL` | api | — | `7d` | Refresh-token lifetime |
| `STORAGE_DRIVER` | api | — | `local` | `local` \| `s3` |
| `STORAGE_LOCAL_DIR` | api | — | `./uploads` | Local upload root |
| `STORAGE_S3_BUCKET` | api | — | — | S3 bucket (when driver=s3) |
| `STORAGE_S3_REGION` | api | — | — | S3 region (when driver=s3) |
| `WEB_ORIGIN` | api | — | `http://localhost:5173` | CORS allow-origin |
| `SEED_OWNER_EMAIL` | api/seed | — | `owner@azadev.in` | Initial Owner login |
| `SEED_OWNER_PASSWORD` | api/seed | — | `Azad@12345` | Initial Owner password |
| `VITE_API_BASE_URL` | web | — | `http://localhost:3000/api/v1` | API base URL for the frontend |

## 9. Frontend conventions
- Feature-sliced under `features/<name>/` (`api.ts`, `*-context.tsx`, `pages`). Shared UI in `components/` (`ui` shadcn primitives, `layout`, `brand`, `common`). No cross-feature imports except via `components/` and `lib/`.
- Data fetching through React Query; forms through React Hook Form + Zod (schemas reused from `@azad/shared`).
- Theming via CSS variables (brand tokens) + `class` dark mode. See [docs/UI-COMPONENTS.md](docs/UI-COMPONENTS.md).

## 10. API documentation
Swagger UI at `http://localhost:3000/api/docs` (OpenAPI JSON at `/api/docs-json`), generated from controller decorators with a bearer-auth scheme.
