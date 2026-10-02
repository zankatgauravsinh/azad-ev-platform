import './common/bigint-serializer';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
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
import { ServiceModule } from './modules/service/service.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { ReportsModule } from './modules/reports/reports.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { WarrantyModule } from './modules/warranty/warranty.module';
import { FinanceModule } from './modules/finance/finance.module';
import { DeliveryModule } from './modules/delivery/delivery.module';
import { CompanySettingsModule } from './modules/settings/company-settings.module';
import { PdfBrandModule } from './common/pdf/pdf-brand.module';
import { ReturnsModule } from './modules/returns/returns.module';
import { StaffModule } from './users/staff.module';
import { RolesModule } from './modules/roles/roles.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

@Module({
  imports: [
    AppConfigModule,
    TenantModule,
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 120 }],
      // Rate limiting would make the serial e2e suite (many logins from one IP) flaky.
      skipIf: () => process.env.NODE_ENV === 'test',
    }),
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
    ServiceModule,
    DashboardModule,
    ReportsModule,
    NotificationsModule,
    WarrantyModule,
    FinanceModule,
    DeliveryModule,
    CompanySettingsModule,
    PdfBrandModule,
    ReturnsModule,
    StaffModule,
    RolesModule,
  ],
  providers: [
    // Order matters: authenticate → throttle → authorize.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Tenant context must wrap the handler (outermost) so every query is scoped.
    { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
  ],
})
export class AppModule {}
