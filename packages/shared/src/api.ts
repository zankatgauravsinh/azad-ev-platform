/** Standard API response/error envelopes shared by API and Web. */

export interface ApiError {
  statusCode: number;
  error: string;
  message: string;
  details?: unknown;
  path?: string;
  timestamp?: string;
}

export interface ApiListMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ApiListResponse<T> {
  data: T[];
  meta: ApiListMeta;
}
