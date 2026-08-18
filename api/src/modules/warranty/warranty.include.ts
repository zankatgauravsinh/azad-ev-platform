import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Shared include: warranty rows always carry the customer + vehicle identity. */
export const warrantyInclude = {
  customer: { select: { id: true, name: true } },
  unit: {
    select: {
      id: true,
      vin: true,
      motorNumber: true,
      batteryNumber: true,
      variant: { select: { name: true, model: { select: { name: true } } } },
    },
  },
} satisfies Prisma.WarrantyInclude;

export type WarrantyRow = Prisma.WarrantyGetPayload<{ include: typeof warrantyInclude }>;
export type AmcRow = Prisma.AmcPlanGetPayload<{ include: typeof warrantyInclude }>;

/** Resolve technician display names for a set of ids in one query. */
export async function technicianNames(prisma: PrismaService, ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((i): i is string => !!i))];
  if (unique.length === 0) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}
