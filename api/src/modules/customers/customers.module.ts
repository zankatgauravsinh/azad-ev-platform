import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { CustomersRepository } from './customers.repository';
import { CustomerTimelineService } from './customer-timeline.service';
import { NotesService } from './notes.service';
import { FollowUpsService } from './follow-ups.service';

@Module({
  controllers: [CustomersController],
  providers: [CustomersService, CustomersRepository, CustomerTimelineService, NotesService, FollowUpsService],
  // Exported so later modules (Booking, Sales, Delivery, Service) can append timeline entries.
  exports: [CustomerTimelineService, CustomersService, FollowUpsService],
})
export class CustomersModule {}
