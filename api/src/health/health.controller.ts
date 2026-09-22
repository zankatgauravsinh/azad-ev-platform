import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness + database connectivity check' })
  async check(): Promise<{ status: string; db: string; timestamp: string }> {
    let db = 'up';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      db = 'down';
    }
    const body = { status: db === 'up' ? 'ok' : 'degraded', db, timestamp: new Date().toISOString() };
    // Reflect DB failure in the HTTP status so load balancers and uptime
    // monitors mark the instance unhealthy instead of seeing a 200.
    if (db === 'down') throw new ServiceUnavailableException(body);
    return body;
  }
}
