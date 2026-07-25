import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { Injectable, NotFoundException } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { TenantContext } from '../tenant/tenant-context.service';
import type { SaveFileInput, StorageService, StoredFile } from './storage.service';

@Injectable()
export class LocalStorageService implements StorageService {
  private readonly baseDir: string;

  constructor(
    private readonly config: AppConfigService,
    private readonly tenant: TenantContext,
  ) {
    this.baseDir = resolve(process.cwd(), this.config.get('STORAGE_LOCAL_DIR'));
  }

  async save(input: SaveFileInput): Promise<StoredFile> {
    // Company-scoped: every file lands under companies/<companyId>/… so tenants
    // never share a storage namespace (an S3 impl would use the same key prefix).
    const companyId = this.tenant.getCompanyId() ?? 'system';
    const safeFolder = this.sanitizeFolder(`companies/${companyId}/${input.folder}`);
    const ext = extname(input.originalName).toLowerCase();
    const fileKey = join(safeFolder, `${randomUUID()}${ext}`).split(sep).join('/');
    const absolute = this.absolutePath(fileKey);

    await fs.mkdir(resolve(absolute, '..'), { recursive: true });
    await fs.writeFile(absolute, input.buffer);

    return {
      fileKey,
      fileName: input.originalName,
      mimeType: input.mimeType,
      sizeBytes: input.buffer.byteLength,
    };
  }

  async read(fileKey: string): Promise<Buffer> {
    try {
      return await fs.readFile(this.absolutePath(fileKey));
    } catch {
      throw new NotFoundException('File not found');
    }
  }

  async remove(fileKey: string): Promise<void> {
    await fs.rm(this.absolutePath(fileKey), { force: true });
  }

  urlFor(fileKey: string): string {
    return `/api/v1/uploads/${encodeURIComponent(fileKey)}`;
  }

  /** Resolve a key to an absolute path, guarding against path traversal. */
  private absolutePath(fileKey: string): string {
    const absolute = resolve(this.baseDir, normalize(fileKey));
    if (!absolute.startsWith(this.baseDir + sep) && absolute !== this.baseDir) {
      throw new NotFoundException('Invalid file path');
    }
    return absolute;
  }

  private sanitizeFolder(folder: string): string {
    return folder
      .split('/')
      .map((seg) => seg.replace(/[^a-zA-Z0-9._-]/g, ''))
      .filter(Boolean)
      .join('/');
  }
}
