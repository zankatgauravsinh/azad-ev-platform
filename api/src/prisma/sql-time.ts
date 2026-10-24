import { Prisma } from '@prisma/client';

/**
 * Raw-SQL time values for the DateTime columns, which are `timestamp(3)` WITHOUT time zone holding UTC.
 *
 * Prisma binds a JS Date in `$queryRaw` as `timestamptz`, and `now()` is `timestamptz` too. Postgres compares a
 * `timestamptz` with a plain `timestamp` column by reading the column in the SESSION time zone — so on a database
 * that runs Asia/Kolkata every such comparison is off by 5h30 (a sale invoiced at 05:28Z falls outside
 * [00:00Z, 23:59Z]). In raw SQL, compare those columns only with these, never with a bare `${date}` or `now()`:
 * they are plain UTC timestamps, so the result is the same whatever the session time zone is.
 */

/** An instant as a UTC `timestamp` (the zone suffix of the ISO string is ignored by the cast — it is UTC already). */
export const utcTimestamp = (instant: Date): Prisma.Sql => Prisma.sql`${instant.toISOString()}::timestamp`;

/** The current instant as a UTC `timestamp` — `now()` for comparisons and `date_trunc` against the columns. */
export const UTC_NOW: Prisma.Sql = Prisma.sql`(now() AT TIME ZONE 'UTC')`;
