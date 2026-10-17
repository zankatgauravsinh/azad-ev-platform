import { Module } from '@nestjs/common';
import { AccessoriesController } from './accessories.controller';
import { AccessoriesService } from './accessories.service';

/** The accessory catalogue and (in later stages) its stock: purchases, opening stock, adjustments. */
@Module({
  controllers: [AccessoriesController],
  providers: [AccessoriesService],
  exports: [AccessoriesService],
})
export class AccessoriesModule {}
