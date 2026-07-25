export interface StoredFile {
  fileKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface SaveFileInput {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  /** Logical folder, e.g. 'customers/<id>' or 'deliveries/<id>'. */
  folder: string;
}

/** Injection token for the active storage driver. */
export const STORAGE_SERVICE = Symbol('STORAGE_SERVICE');

/**
 * Storage abstraction. `LocalStorageService` implements it today;
 * an `S3StorageService` can be dropped in later without touching callers.
 */
export interface StorageService {
  save(input: SaveFileInput): Promise<StoredFile>;
  read(fileKey: string): Promise<Buffer>;
  remove(fileKey: string): Promise<void>;
  /** Public/temporary URL for a stored object. */
  urlFor(fileKey: string): string;
}
