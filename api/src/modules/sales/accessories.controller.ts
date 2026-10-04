import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createAccessorySchema, type CreateAccessoryInput } from '@azad/shared';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../prisma/prisma.service';

@ApiTags('Accessories')
@ApiBearerAuth('access-token')
@Controller('accessories')
export class AccessoriesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Permissions('accessories.view')
  @ApiOperation({ summary: 'List accessories / parts catalogue' })
  list(@Query('q') q?: string, @Query('isPart') isPart?: string) {
    return this.prisma.accessory.findMany({
      where: {
        isActive: true,
        ...(isPart !== undefined ? { isPart: isPart === 'true' } : {}),
        ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}),
      },
      orderBy: { name: 'asc' },
    });
  }

  @Post()
  @Permissions('accessories.manage')
  @ApiOperation({ summary: 'Add an accessory / part' })
  create(@Body(new ZodValidationPipe(createAccessorySchema)) dto: CreateAccessoryInput, @CurrentUser('id') userId: string) {
    // avgCost / onHand / reserved are system-maintained (opening stock & purchases) — never set here.
    return this.prisma.accessory.create({
      data: { name: dto.name, sku: dto.sku ?? null, category: dto.category ?? null, sellPrice: BigInt(dto.sellPrice), minStock: dto.minStock, isPart: dto.isPart, createdById: userId, updatedById: userId },
    });
  }
}
