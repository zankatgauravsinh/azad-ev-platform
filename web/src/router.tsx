import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from '@/components/layout/app-shell';
import { NotFound } from '@/components/common/not-found';
import { LoginPage } from '@/features/auth/login-page';
import { RequireAuth, RequireGuest } from '@/features/auth/route-guards';
import { AccountPage } from '@/features/account/account-page';
import { InventoryListPage } from '@/features/inventory/pages/inventory-list-page';
import { InventoryDetailPage } from '@/features/inventory/pages/inventory-detail-page';
import { CustomersListPage } from '@/features/customers/pages/customers-list-page';
import { CustomerDetailPage } from '@/features/customers/pages/customer-detail-page';
import { QuotationsListPage } from '@/features/sales/pages/quotations-list-page';
import { QuotationDetailPage } from '@/features/sales/pages/quotation-detail-page';
import { BookingsListPage } from '@/features/sales/pages/bookings-list-page';
import { BookingDetailPage } from '@/features/sales/pages/booking-detail-page';
import { DashboardPage } from '@/features/dashboard/pages/dashboard-page';
import { ServiceListPage } from '@/features/service/pages/service-list-page';
import { ServiceDetailPage } from '@/features/service/pages/service-detail-page';
import { SparePartsPage } from '@/features/service/pages/spare-parts-page';
import { ServiceReportsPage } from '@/features/service/pages/service-reports-page';
import { SettingsPage } from '@/features/settings/pages/settings-page';
import { ReportsPage } from '@/features/reports/pages/reports-page';
import { WarrantyPage } from '@/features/warranty/pages/warranty-page';
import { FinancePage } from '@/features/finance/pages/finance-page';
import { DeliveryPage } from '@/features/delivery/pages/delivery-page';
import { ReturnsListPage } from '@/features/returns/pages/returns-list-page';
import { StaffListPage } from '@/features/staff/pages/staff-list-page';

export const router = createBrowserRouter([
  {
    element: <RequireGuest />,
    children: [{ path: '/login', element: <LoginPage /> }],
  },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: '/', element: <AccountPage /> },
          { path: '/dashboard', element: <DashboardPage /> },
          { path: '/inventory', element: <InventoryListPage /> },
          { path: '/inventory/:id', element: <InventoryDetailPage /> },
          { path: '/customers', element: <CustomersListPage /> },
          { path: '/customers/:id', element: <CustomerDetailPage /> },
          { path: '/quotations', element: <QuotationsListPage /> },
          { path: '/quotations/:id', element: <QuotationDetailPage /> },
          { path: '/bookings', element: <BookingsListPage /> },
          { path: '/bookings/:id', element: <BookingDetailPage /> },
          { path: '/service', element: <ServiceListPage /> },
          { path: '/service/spare-parts', element: <SparePartsPage /> },
          { path: '/service/reports', element: <ServiceReportsPage /> },
          { path: '/service/:id', element: <ServiceDetailPage /> },
          { path: '/warranty', element: <WarrantyPage /> },
          { path: '/delivery', element: <DeliveryPage /> },
          { path: '/returns', element: <ReturnsListPage /> },
          { path: '/finance', element: <FinancePage /> },
          { path: '/reports', element: <ReportsPage /> },
          { path: '/settings', element: <SettingsPage /> },
          { path: '/staff', element: <StaffListPage /> },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
]);
