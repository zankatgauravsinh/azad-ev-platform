import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { AuthenticatedRequest } from '../types/authenticated-request';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const { method, url } = request;
    const startedAt = Date.now();
    const actor = request.user?.email ?? 'anonymous';

    return next.handle().pipe(
      tap({
        next: () => this.logger.log(`${method} ${url} (${actor}) → ${Date.now() - startedAt}ms`),
        error: () => this.logger.warn(`${method} ${url} (${actor}) → error in ${Date.now() - startedAt}ms`),
      }),
    );
  }
}
