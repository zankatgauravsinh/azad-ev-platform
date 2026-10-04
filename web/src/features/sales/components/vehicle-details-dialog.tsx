import type { ReactNode } from 'react';
import { Bike } from 'lucide-react';
import { formatPaise } from '@/lib/money';
import { unitStatusLabel, unitStatusTone } from '@/lib/labels';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { VehicleUnitDetail } from '../api';

/**
 * Read-only popup of the allocated vehicle. Everything shown comes from the existing
 * InventoryUnit → variant → model graph already returned by the booking read (no duplication).
 * Only fields that exist and hold a value are rendered; dealer-margin fields (purchaseCost,
 * supplier) are never included. Internal database ids are not displayed.
 */
type Item = { label: string; value: ReactNode };
const present = (v: unknown): boolean => v !== null && v !== undefined && v !== '';
const fmtDate = (iso: string | null): string => (iso ? new Date(iso).toLocaleDateString('en-IN') : '');

function Section({ title, items }: { title: string; items: Item[] }): JSX.Element | null {
  const rows = items.filter((i) => present(i.value));
  if (rows.length === 0) return null;
  return (
    <section>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="divide-y rounded-lg border px-3">
        {rows.map((r) => (
          <div key={r.label} className="flex justify-between gap-6 py-1.5 text-sm">
            <span className="shrink-0 text-muted-foreground">{r.label}</span>
            <span className="text-right font-medium">{r.value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Colour({ colour, hex }: { colour: string; hex: string | null }): JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5">
      {hex ? <span aria-hidden className="inline-block h-3 w-3 rounded-full border" style={{ backgroundColor: hex }} /> : null}
      {colour}
    </span>
  );
}

const mono = (s: string): JSX.Element => <span className="font-mono">{s}</span>;

export function VehicleDetailsDialog({
  open,
  onOpenChange,
  unit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  unit: VehicleUnitDetail | null;
}): JSX.Element {
  const v = unit?.variant;
  const m = v?.model;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Bike className="h-5 w-5" /> Vehicle details</DialogTitle>
          <DialogDescription>{m ? `${m.brand} ${m.name}${v ? ` · ${v.name}` : ''}` : 'Allocated vehicle'}</DialogDescription>
        </DialogHeader>

        {!unit || !v || !m ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No vehicle details available.</p>
        ) : (
          <div className="space-y-4">
            <Section
              title="Vehicle"
              items={[
                { label: 'Model', value: m.name },
                { label: 'Manufacturer', value: m.brand },
                { label: 'Variant', value: v.name },
                { label: 'Colour', value: v.colour ? <Colour colour={v.colour} hex={v.hexColour} /> : undefined },
                { label: 'Description', value: m.description },
              ]}
            />
            <Section
              title="Specifications"
              items={[
                { label: 'Battery type', value: v.batteryType },
                { label: 'Battery capacity', value: v.batteryCapacity },
                { label: 'Range', value: v.rangeKm != null ? `${v.rangeKm} km` : undefined },
                { label: 'Top speed', value: v.topSpeedKmph != null ? `${v.topSpeedKmph} km/h` : undefined },
                { label: 'Charging time', value: v.chargingTimeHrs != null ? `${v.chargingTimeHrs} hrs` : undefined },
                { label: 'Motor power', value: v.motorPowerW != null ? `${v.motorPowerW} W` : undefined },
                { label: 'Warranty', value: v.warrantyMonths != null ? `${v.warrantyMonths} months` : undefined },
              ]}
            />
            <Section
              title="Identification"
              items={[
                { label: 'VIN', value: mono(unit.vin) },
                { label: 'Motor no.', value: mono(unit.motorNumber) },
                { label: 'Battery no.', value: mono(unit.batteryNumber) },
              ]}
            />
            <Section
              title="Status"
              items={[
                { label: 'Current status', value: <Badge variant={unitStatusTone(unit.status)}>{unitStatusLabel(unit.status)}</Badge> },
                { label: 'Location', value: unit.location },
                { label: 'Purchase date', value: fmtDate(unit.purchaseDate) || undefined },
                { label: 'Selling price', value: unit.sellingPrice && unit.sellingPrice !== '0' ? formatPaise(unit.sellingPrice) : undefined },
              ]}
            />
            {unit.notes && unit.notes.trim() ? (
              <section>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notes</h3>
                <p className="whitespace-pre-wrap rounded-lg border bg-muted/30 p-3 text-sm">{unit.notes}</p>
              </section>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
