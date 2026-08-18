import { Controller, Get, Inject, Param, Res } from '@nestjs/common';
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
 * Serves stored files. Keys are unguessable UUIDs (local storage). Marked public
 * so `<img src>` works without an auth header; when moved to S3 this becomes a
 * signed URL instead. See ARCHITECTURE §6.
 */
@ApiTags('Uploads')
@Controller('uploads')
export class UploadsController {
  constructor(@Inject(STORAGE_SERVICE) private readonly storage: StorageService) {}

  @Public()
  @Get(':key')
  @ApiOperation({ summary: 'Stream a stored file by key' })
  async serve(@Param('key') key: string, @Res() res: Response): Promise<void> {
    const fileKey = decodeURIComponent(key);
    const buffer = await this.storage.read(fileKey);
    const ext = fileKey.split('.').pop()?.toLowerCase() ?? '';
    res.setHeader('Content-Type', MIME_BY_EXT[ext] ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(buffer);
  }
}
