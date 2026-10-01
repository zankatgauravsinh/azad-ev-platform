import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { SalesModule } from '../sales/sales.module';
import { FinanceController } from './finance.controller';
import { ExpensesController } from './expenses.controller';
import { VendorsController } from './vendors.controller';
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

@Module({
  imports: [CustomersModule, SalesModule, MonthlyClosingModule], // CustomerTimelineService + SequenceService (StorageModule is @Global)
  controllers: [FinanceController, ExpensesController, VendorsController, IncomeController, BankController],
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
  exports: [ExpensesService, PnlService, CashbookService],
})
export class FinanceModule {}
