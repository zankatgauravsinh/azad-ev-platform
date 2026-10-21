import { Module } from '@nestjs/common';
import { GstModule } from '../gst/gst.module';
import { CustomersModule } from '../customers/customers.module';
import { SalesModule } from '../sales/sales.module';
import { FinanceController } from './finance.controller';
import { ExpensesController } from './expenses.controller';
import { VendorsController } from './vendors.controller';
import { VendorOptionsController } from './vendor-options.controller';
import { IncomeController } from './income.controller';
import { BankController } from './bank.controller';
import { ExpenseCategoriesService } from './expense-categories.service';
import { VendorsService } from './vendors.service';
import { ExpensesService } from './expenses.service';
import { IncomeService } from './income.service';
import { BankService } from './bank.service';
import { CashbookService } from './cashbook.service';
import { PnlService } from './pnl.service';
import { FinanceDashboardService } from './finance-dashboard.service';
import { FinancePdfService } from './finance-pdf.service';
import { RecurringExpensesService } from './recurring-expenses.service';
import { MonthlyClosingModule } from './monthly-closing.module';
import { VendorPayablesModule } from '../vendor-payables/vendor-payables.module';

@Module({
  imports: [CustomersModule, SalesModule, MonthlyClosingModule, VendorPayablesModule, GstModule], // CustomerTimelineService + SequenceService (StorageModule is @Global)
  controllers: [FinanceController, ExpensesController, VendorsController, VendorOptionsController, IncomeController, BankController],
  providers: [
    ExpenseCategoriesService,
    VendorsService,
    ExpensesService,
    IncomeService,
    BankService,
    CashbookService,
    PnlService,
    FinanceDashboardService,
    FinancePdfService,
    RecurringExpensesService,
  ],
  exports: [ExpensesService, PnlService, CashbookService, VendorsService],
})
export class FinanceModule {}
