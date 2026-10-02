import { ArgumentMetadata, BadRequestException, PipeTransform } from '@nestjs/common';
import { ZodType, ZodTypeDef } from 'zod';

/**
 * Validates and parses an argument against a Zod schema.
 * Usage: `@Body(new ZodValidationPipe(loginSchema)) dto: LoginInput`.
 *
 * The schema's input type is intentionally unconstrained so schemas whose parsed output
 * differs from their raw input (e.g. a query field using `.transform()` / `.default()`)
 * are accepted; only the parsed output type `T` is pinned. Runtime behaviour is unchanged.
 */
export class ZodValidationPipe<T> implements PipeTransform {
  constructor(private readonly schema: ZodType<T, ZodTypeDef, unknown>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        details: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }
    return result.data;
  }
}
