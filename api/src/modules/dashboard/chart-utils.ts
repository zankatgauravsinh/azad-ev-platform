import type { MonthlyPoint } from '@azad/shared';

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface MonthRow {
  month: string; // YYYY-MM
  amount: bigint | number | string;
  count: number;
}

/** Expand aggregate rows into the last `months` calendar months, filling gaps with zeroes. */
export function fillMonths(rows: MonthRow[], now = new Date(), months = 6): MonthlyPoint[] {
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  const out: MonthlyPoint[] = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const row = byMonth.get(key);
    out.push({
      month: key,
      label: MONTH_LABELS[d.getMonth()] ?? key,
      amount: (row?.amount ?? 0).toString(),
      count: Number(row?.count ?? 0),
    });
  }
  return out;
}
