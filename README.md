# AZAD EV POINT — Showroom Management System

Single-dealership operations app for **AZAD EV POINT** (Una, Gujarat) — EV scooter dealer & service centre.
Not an ERP, not multi-tenant SaaS. One showroom, 3–10 daily users.

- **Frontend:** React 19 · TypeScript · Vite · Tailwind · shadcn/ui · React Router · React Query · React Hook Form · Zod
- **Backend:** NestJS · Prisma · PostgreSQL · JWT
- **Storage:** local uploads behind an S3-ready `StorageService`

## Layout
```
app/
├── docs/            planning docs (PRD, flows, DB, API, wireframes, roadmap) + per-module docs
├── packages/shared/ enums + Zod contracts shared by api & web
├── api/             NestJS backend (feature modules, Prisma)
└── web/             React frontend (feature slices)
```

## Prerequisites
Node ≥ 20, Docker (for Postgres), npm.

## Quick start
```bash
cd app
cp .env.example .env
npm install
npm run db:up                                 # Postgres on :5432
npm run build --workspace packages/shared
npm run prisma:migrate --workspace api        # create schema
npm run prisma:seed --workspace api           # company + owner + models
npm run dev                                    # api :3000 · web :5173
```
Sign in: `owner@azadev.in` / `Azad@12345` (change in `.env`).

## Scripts (root)
| Command | Purpose |
|---|---|
| `npm run dev` | run api + web together |
| `npm run db:up` / `db:down` | start/stop Postgres |
| `npm run prisma:migrate` | apply DB migrations |
| `npm run prisma:seed` | seed initial data |
| `npm test` | api unit tests |
| `npm run build` | build shared + api + web |

## Progress
Built module by module — see [docs/07-ROADMAP.md](docs/07-ROADMAP.md) and `docs/modules/`.
- ✅ **Module 0** — Foundation & Auth
- ✅ **Module 1** — Inventory
- ✅ **Module 2** — Customer Domain
- ✅ **Module 3** — Sales Domain (quotations → bookings → payments → finance → insurance → invoice → delivery)
- ✅ **Module 4** — Dashboard (operational control center) + global search
- ⏭ Module 5 — Service (next)

Order: Inventory → Customers → Sales → Dashboard → Service → Reports.
