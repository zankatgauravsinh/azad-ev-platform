# AZAD EV POINT — 4. Folder Structure

Monorepo with two apps. Feature-based architecture on both sides. Shared types via a small package. **Package manager: npm workspaces** (npm is already installed; no pnpm required).

```
app/
├── docs/                       # these planning documents
├── package.json                # npm workspaces root (workspaces: api, web, packages/*)
├── docker-compose.yml          # postgres (local dev)
├── .env.example
├── README.md
│
├── packages/
│   └── shared/                 # shared TS types & Zod schemas used by web + api
│       ├── src/
│       │   ├── enums.ts
│       │   ├── dto/            # request/response contracts mirrored from Zod
│       │   └── index.ts
│       └── package.json
│
├── api/                        # NestJS backend
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── migrations/
│   │   └── seed.ts
│   ├── src/
│   │   ├── main.ts
│   │   ├── app.module.ts
│   │   ├── common/             # cross-cutting
│   │   │   ├── decorators/     # @CurrentUser, @Roles, @Public
│   │   │   ├── guards/         # JwtAuthGuard, RolesGuard
│   │   │   ├── interceptors/   # LoggingInterceptor, TransformInterceptor
│   │   │   ├── filters/        # AllExceptionsFilter (RFC-7807 style)
│   │   │   ├── pipes/          # ZodValidationPipe
│   │   │   ├── middleware/     # request-id, rate-limit
│   │   │   └── utils/          # money.ts, pagination.ts, codes.ts
│   │   ├── config/             # env schema (Zod), config.module
│   │   ├── prisma/             # PrismaService (+ soft-delete middleware)
│   │   ├── storage/            # StorageService interface + LocalStorage impl (S3-ready)
│   │   ├── auth/               # controller, service, strategies, dto
│   │   └── modules/            # one folder per feature (mirrors DB/PRD)
│   │       ├── users/
│   │       ├── customers/
│   │       ├── inventory/      # models, variants, units
│   │       ├── test-rides/
│   │       ├── bookings/
│   │       ├── quotations/
│   │       ├── sales/
│   │       ├── payments/
│   │       ├── deliveries/
│   │       ├── service/
│   │       ├── accessories/
│   │       ├── expenses/
│   │       ├── reports/
│   │       ├── dashboard/
│   │       ├── notifications/
│   │       ├── activity-log/
│   │       ├── uploads/
│   │       ├── search/         # global search
│   │       └── settings/       # company + invoice settings, backup
│   ├── test/                   # e2e
│   ├── nest-cli.json
│   └── package.json
│
└── web/                        # React 19 + Vite frontend
    ├── index.html
    ├── vite.config.ts
    ├── tailwind.config.ts
    ├── components.json         # shadcn config
    ├── src/
    │   ├── main.tsx
    │   ├── App.tsx
    │   ├── router.tsx          # React Router route tree (role-guarded)
    │   ├── app/                # providers: QueryClient, Theme, Auth
    │   ├── lib/                # apiClient(axios), queryKeys, money.ts, cn.ts
    │   ├── components/
    │   │   ├── ui/             # shadcn primitives (button, dialog, table…)
    │   │   ├── layout/         # Sidebar, Topbar, Shell, MobileNav
    │   │   ├── data-table/     # reusable table: pagination/sort/filter
    │   │   ├── forms/          # FormField wrappers over RHF + Zod
    │   │   ├── charts/         # recharts wrappers
    │   │   ├── uploader/       # image/document uploader + signature pad
    │   │   └── common/         # StatCard, EmptyState, StatusBadge, PageHeader
    │   ├── features/           # one folder per module
    │   │   ├── auth/
    │   │   ├── dashboard/
    │   │   ├── customers/      # api.ts, hooks.ts, schema.ts, pages/, components/
    │   │   ├── inventory/
    │   │   ├── test-rides/
    │   │   ├── bookings/
    │   │   ├── sales/
    │   │   ├── deliveries/
    │   │   ├── service/
    │   │   ├── expenses/
    │   │   ├── reports/
    │   │   └── settings/
    │   ├── hooks/              # useAuth, useDebounce, useMediaQuery, useTheme
    │   ├── types/              # from @azad/shared
    │   └── styles/             # globals.css (brand tokens as CSS vars)
    └── package.json
```

### Conventions
- **Backend module** = `*.module.ts`, `*.controller.ts`, `*.service.ts`, `*.repository.ts`, `dto/*.dto.ts`. Controllers thin, services hold logic, repositories wrap Prisma. DTO validation via Zod schemas shared with the frontend.
- **Frontend feature** = `api.ts` (typed calls) + `hooks.ts` (React Query) + `schema.ts` (Zod, reused from shared) + `pages/` + `components/`. No cross-feature imports except via `components/` and `lib/`.
- **Brand tokens** live once in `web/src/styles/globals.css` as CSS variables (`--brand-navy`, `--brand-teal`, `--brand-gold`) and are mapped into `tailwind.config.ts`.
- **Strict TypeScript** (`strict: true`, `noUncheckedIndexedAccess`) on both apps. ESLint + Prettier shared config. No `any`.
