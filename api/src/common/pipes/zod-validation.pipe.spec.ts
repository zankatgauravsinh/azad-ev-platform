import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe';

describe('ZodValidationPipe', () => {
  const schema = z.object({ email: z.string().email(), age: z.number().int().min(0) });
  const pipe = new ZodValidationPipe(schema);
  const meta = { type: 'body' } as const;

  it('returns parsed data for valid input', () => {
    const result = pipe.transform({ email: 'a@b.com', age: 30 }, meta);
    expect(result).toEqual({ email: 'a@b.com', age: 30 });
  });

  it('throws BadRequestException with field details for invalid input', () => {
    try {
      pipe.transform({ email: 'not-an-email', age: -1 }, meta);
      fail('expected pipe to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const response = (error as BadRequestException).getResponse() as { details: unknown[] };
      expect(response.details.length).toBeGreaterThanOrEqual(2);
    }
  });
});
