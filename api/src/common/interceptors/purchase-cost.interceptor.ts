import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, from } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import { PURCHASE_COST_FIELDS, PURCHASE_COST_PERMISSION } from '@azad/shared';
import type { AuthenticatedRequest } from '../types/authenticated-request';
import { PermissionResolver, effectivePermissions } from '../rbac/permission-resolver.service';

const COST_KEYS: ReadonlySet<string> = new Set(PURCHASE_COST_FIELDS);

/** Removes the purchase-cost keys from a response, at any depth (vehicles are nested in bookings, deliveries…). */
export function withoutPurchaseCost(value: unknown): unknown {
  if (Array.isArray(value)) {
    for (const item of value) withoutPurchaseCost(item);
  } else if (value !== null && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    for (const key of Object.keys(value)) {
      if (COST_KEYS.has(key)) delete (value as Record<string, unknown>)[key];
      else withoutPurchaseCost((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

/**
 * Purchase cost is the owner's by default: only a caller holding `inventory.cost` receives it. Applied to every
 * JSON response, so any endpoint that returns a vehicle — inventory, bookings, deliveries, returns — is covered
 * without each one remembering to. (File downloads written with @Res() never pass through here, and none of
 * them carry purchase cost; the inventory CSV export leaves the column out itself.)
 */
@Injectable()
export class PurchaseCostInterceptor implements NestInterceptor {
  constructor(private readonly resolver: PermissionResolver) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return next.handle().pipe(
      mergeMap((body) =>
        from(
          (async () => {
            if (!request.user) return body; // public routes carry no vehicle data
            const permissions = await effectivePermissions(request, this.resolver);
            return permissions.has(PURCHASE_COST_PERMISSION) ? body : withoutPurchaseCost(body);
          })(),
        ),
      ),
    );
  }
}
