import { render, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { BarChart } from './bar-chart';
import { DailyBars } from '@/features/reports/components/report-charts';

afterEach(cleanup);

// QA M4: every bar rendered 0px tall. A bar's height is a percentage of its column, and a column inside an
// `items-end` row only has a height if it stretches to the row's — so each column must be full height.
describe('bar charts', () => {
  it('BarChart columns fill the chart height, and bars scale to the largest month', () => {
    const { container } = render(<BarChart points={[{ month: '2026-09', label: 'Sep', amount: '5000', count: 1 }, { month: '2026-10', label: 'Oct', amount: '10000', count: 2 }]} />);
    const row = container.firstElementChild as HTMLElement;
    const columns = [...row.children] as HTMLElement[];
    expect(columns).toHaveLength(2);
    for (const c of columns) expect(c.className).toContain('h-full');
    const bars = columns.map((c) => c.querySelector('[title]') as HTMLElement);
    expect(bars.map((b) => b.style.height)).toEqual(['50%', '100%']);
  });

  it('DailyBars columns fill the chart height', () => {
    const { container } = render(<DailyBars points={[{ date: '2026-10-12', label: '12 Oct', amount: '0', count: 0 }, { date: '2026-10-13', label: '13 Oct', amount: '400', count: 1 }]} />);
    const columns = [...(container.querySelector('.items-end') as HTMLElement).children] as HTMLElement[];
    for (const c of columns) expect(c.className).toContain('h-full');
  });
});
