# Reusable UI Components

All shared UI lives under `web/src/components/`. Features must reuse these — no duplicated buttons, inputs, dialogs, or tables. Built on shadcn/ui (Radix primitives + Tailwind) themed with the AZAD brand tokens.

## Brand tokens
Defined once as CSS variables in `web/src/index.css` and mapped in `tailwind.config.ts`. Never hardcode hex values in components — use the semantic classes.

| Token | Light | Meaning | Tailwind class |
|---|---|---|---|
| `--primary` | Azad Navy `#0B2545` | primary actions, active nav | `bg-primary` / `text-primary` |
| `--accent` | Azad Teal `#00B8A9` | focus rings, links, emphasis | `bg-accent` / `text-accent` |
| `--gold` | Azad Gold `#F2A93B` | highlights (labels/headings only) | `bg-gold` / `text-gold` |
| `--destructive` | red | delete/danger | `bg-destructive` |
| `--muted` / `--secondary` | cloud grey | surfaces, breathing room | `bg-muted` / `bg-secondary` |

Dark mode: add/remove `.dark` on `<html>` (handled by `ThemeProvider`). All tokens have dark values.

## `components/ui/` — primitives
| Component | Purpose | Key props |
|---|---|---|
| `Button` | All buttons | `variant`: `default \| accent \| destructive \| outline \| secondary \| ghost \| link`; `size`: `default \| sm \| lg \| icon`; `asChild` |
| `Input` | Text inputs | native `<input>` props; supports `aria-invalid` styling |
| `Label` | Form labels (Radix) | `htmlFor` |
| `Card` (+ `CardHeader/Title/Description/Content/Footer`) | Content surface | composition |
| `DropdownMenu` (+ `Trigger/Content/Item/Label/Separator`) | Menus (Radix) | `align`, `sideOffset` |
| `Dialog` (+ `Header/Footer/Title/Description/Content`) | Modals (Radix) | controlled `open`/`onOpenChange` |
| `Select` (+ `Trigger/Content/Item/Value`) | Dropdown select (Radix) | `value`, `onValueChange` |
| `Tabs` (+ `List/Trigger/Content`) | Tabbed panels (Radix) | `defaultValue`/`value` |
| `Table` (+ `Header/Body/Row/Head/Cell`) | Low-level table primitives | — |
| `Badge` | Status/label pill | `variant`: default/secondary/accent/success/warning/info/muted/destructive |
| `Textarea` · `Skeleton` | Multiline input · loading placeholder | — |
| `Avatar` (+ `AvatarImage/AvatarFallback`) | User avatar | fallback initials |
| `Toaster` + `toast()` (sonner) | Notifications | theme-aware; use `toast.success/error(...)` |

### Usage
```tsx
import { Button } from '@/components/ui/button';
<Button variant="accent" size="lg" onClick={save}>Save</Button>

import { toast } from 'sonner';
toast.success('Saved');
```

## `components/brand/`
| Component | Purpose | Props |
|---|---|---|
| `BrandMark` | Approved logo (navy pin + teal “A”), scalable SVG | `className` (size) |

## `components/layout/`
| Component | Purpose | Notes |
|---|---|---|
| `AppShell` | Authenticated shell: sidebar + topbar + `<Outlet/>`; mobile drawer | wraps all protected routes |
| `Sidebar` | Role-aware nav from `nav-items.ts`; unbuilt modules render a disabled “Soon” state | `role`, `onNavigate` |
| `ThemeToggle` | Light/dark switch | uses `useTheme` |
| `UserMenu` | Avatar dropdown: account, sign out | uses `useAuth` |
| `nav-items.ts` | Single source for sidebar structure + `visibleNavItems(role)` | flip `enabled: true` as modules ship |

## `components/common/`
| Component | Purpose |
|---|---|
| `DataTable<T>` | Reusable table: sortable headers, row click, loading skeletons, empty state, pagination footer (server-driven) |
| `StatCard` | KPI tile; optional clickable/active state |
| `PageHeader` | Title + description + actions row |
| `EmptyState` | Icon + title + description + optional action |
| `ConfirmDialog` | Async confirm modal (destructive variant) |
| `FullPageLoader` | Centered spinner for auth/loading gates |
| `NotFound` | 404 page with a link home |

### Feature-shared (reused across modules)
| Component | Purpose |
|---|---|
| `VinScanner` (`features/inventory/components`) | Camera QR/barcode scanner (ZXing); reused by Booking/Delivery |
| `UnitStatusBadge` / `LeadStatusBadge` / sales `*StatusBadge` | enum → toned `Badge` |
| `CustomerCombobox` (`features/sales`) | Debounced customer search + select, reused by quotation/booking forms |
| `PriceFields` (`features/sales`) | Reusable price-breakup inputs with live on-road total |
| `GlobalSearch` (`features/dashboard`) | ⌘K command palette — customers/VIN/bookings/invoices/phone |
| `BarChart` / `LeadConversion` (`features/dashboard`) | Dependency-free SVG charts |

## `lib/` helpers (shared, non-visual)
| Helper | Purpose |
|---|---|
| `cn(...)` | Merge Tailwind classes (clsx + tailwind-merge) |
| `money.ts` | `formatPaise`, `rupeesToPaise`, `paiseToRupees` (₹ paise ↔ rupees) |
| `labels.ts` | Enum → human labels (`roleLabel`, …) |
| `api-client.ts` | Axios instance + `apiErrorMessage`, silent token refresh |

## Adding a component
1. Check this list first — reuse or extend, don't duplicate.
2. New shadcn primitive → `components/ui/`. New shared widget → `components/common/`.
3. Theme with tokens (no raw hex). Support dark mode. Keyboard-accessible (focus-visible rings via `--ring`).
4. Add it to this document.
