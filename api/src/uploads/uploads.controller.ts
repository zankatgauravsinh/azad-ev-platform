import { Controller, Get, Inject, Param, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { STORAGE_SERVICE, type StorageService } from '../storage/storage.service';

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  pdf: 'application/pdf',
};

/**
 * Serves stored files. The endpoint is unauthenticated so `<img src>` works
 * without an auth header, but every URL carries a time-limited HMAC signature
 * (see LocalStorageService) that is verified here — an unsigned or expired key
 * is rejected. When moved to S3 this becomes a native signed URL. See ARCHITECTURE §6.
 */
@ApiTags('Uploads')
@Controller('uploads')
export class UploadsController {
  constructor(@Inject(STORAGE_SERVICE) private readonly storage: StorageService) {}

  @Public()
  @Get(':key')
  @ApiOperation({ summary: 'Stream a stored file by signed key' })
  async serve(
    @Param('key') key: string,
    @Query('exp') exp: string | undefined,
    @Query('sig') sig: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const fileKey = decodeURIComponent(key);
    this.storage.verifyUrl(fileKey, { exp, sig });
    const buffer = await this.storage.read(fileKey);
    const ext = fileKey.split('.').pop()?.toLowerCase() ?? '';
    res.setHeader('Content-Type', MIME_BY_EXT[ext] ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(buffer);
  }
}
