import './common/bigint-serializer';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { throttlerOptions } from './common/throttle/throttle.config';
import { AppConfigModule } from './config/config.module';
import { TenantModule } from './tenant/tenant.module';
import { TenantInterceptor } from './tenant/tenant.interceptor';
import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './storage/storage.module';
import { ExportModule } from './export/export.module';
import { ActivityLogModule } from './activity-log/activity-log.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { UploadsModule } from './uploads/uploads.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { CustomersModule } from './modules/customers/customers.module';
import { SalesModule } from './modules/sales/sales.module';
import { AccessoriesModule } from './modules/accessories/accessories.module';
import { AccessorySalesModule } from './modules/accessory-sales/accessory-sales.module';
import { ServiceModule } from './modules/service/service.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { ReportsModule } from './modules/reports/reports.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { WarrantyModule } from './modules/warranty/warranty.module';
import { FinanceModule } from './modules/finance/finance.module';
import { DeliveryModule } from './modules/delivery/delivery.module';
import { RtoInvoicesModule } from './modules/rto-invoices/rto-invoices.module';
import { PurchaseCostInterceptor } from './common/interceptors/purchase-cost.interceptor';
import { CompanySettingsModule } from './modules/settings/company-settings.module';
import { PdfBrandModule } from './common/pdf/pdf-brand.module';
import { ReturnsModule } from './modules/returns/returns.module';
import { StaffModule } from './users/staff.module';
import { RolesModule } from './modules/roles/roles.module';
import { TaxModule } from './modules/tax/tax.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { RbacModule } from './common/rbac/rbac.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

@Module({
  imports: [
    AppConfigModule,
    TenantModule,
    // Default 120/min per route per IP, plus the per-user CSV import limit (see throttle.config.ts).
    ThrottlerModule.forRoot(throttlerOptions()),
    PrismaModule,
    StorageModule,
    ExportModule,
    ActivityLogModule,
    UsersModule,
    AuthModule,
    HealthModule,
    UploadsModule,
    InventoryModule,
    CustomersModule,
    SalesModule,
    AccessoriesModule,
    AccessorySalesModule,
    ServiceModule,
    DashboardModule,
    ReportsModule,
    NotificationsModule,
    WarrantyModule,
    FinanceModule,
    DeliveryModule,
    RtoInvoicesModule,
    CompanySettingsModule,
    PdfBrandModule,
    ReturnsModule,
    StaffModule,
    RolesModule,
    TaxModule,
    RbacModule,
  ],
  providers: [
    // Order matters: authenticate → throttle → authorize.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    // Permission-based guard sits after RolesGuard; it is a no-op until routes adopt @Permissions.
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Tenant context must wrap the handler (outermost) so every query is scoped.
    { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    // Purchase cost leaves the API only for callers holding inventory.cost.
    { provide: APP_INTERCEPTOR, useClass: PurchaseCostInterceptor },
  ],
})
export class AppModule {}
