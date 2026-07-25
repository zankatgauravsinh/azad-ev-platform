import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Clock, PackageCheck, Sparkles } from 'lucide-react';
import type { InventoryUnitDto } from '@azad/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { InventoryDashboard } from '../api';

function UnitRow({ unit, onClick }: { unit: InventoryUnitDto; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-secondary"
    >
      <span className="min-w-0 truncate">
        <span className="font-medium">{unit.variant.model.name}</span>{' '}
        <span className="text-muted-foreground">{unit.variant.name} · {unit.variant.colour}</span>
      </span>
      <span className="ml-2 shrink-0 font-mono text-xs text-muted-foreground">{unit.vin}</span>
    </button>
  );
}

export function InventoryWidgets({ dashboard }: { dashboard: InventoryDashboard }): JSX.Element {
  const navigate = useNavigate();
  const go = (id: string): void => {
    void navigate(`/inventory/${id}`);
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-4">
      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <AlertTriangle className="h-4 w-4 text-amber-500" /> Low Inventory
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {dashboard.lowInventory.length === 0 ? (
            <p className="text-sm text-muted-foreground">Stock levels are healthy.</p>
          ) : (
            <ul className="space-y-1.5">
              {dashboard.lowInventory.map((item) => (
                <li key={`${item.brand}-${item.model}`} className="flex items-center justify-between text-sm">
                  <span>
                    {item.brand} {item.model}
                  </span>
                  <Badge variant={item.available === 0 ? 'destructive' : 'warning'}>
                    {item.available} left
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <WidgetList
        title="Recently Added"
        icon={<Sparkles className="h-4 w-4 text-accent" />}
        units={dashboard.recentlyAdded}
        onSelect={go}
        empty="No scooters yet."
      />
      <WidgetList
        title="Reserved"
        icon={<Clock className="h-4 w-4 text-amber-500" />}
        units={dashboard.reserved}
        onSelect={go}
        empty="Nothing reserved."
      />
      <WidgetList
        title="Ready for Delivery"
        icon={<PackageCheck className="h-4 w-4 text-emerald-500" />}
        units={dashboard.readyForDelivery}
        onSelect={go}
        empty="Nothing awaiting delivery."
      />
    </div>
  );
}

function WidgetList({
  title,
  icon,
  units,
  onSelect,
  empty,
}: {
  title: string;
  icon: React.ReactNode;
  units: InventoryUnitDto[];
  onSelect: (id: string) => void;
  empty: string;
}): JSX.Element {
  return (
    <Card>
      <CardHeader className="p-4 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          {icon} {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        {units.length === 0 ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : (
          <div className="-mx-2">
            {units.map((unit) => (
              <UnitRow key={unit.id} unit={unit} onClick={() => onSelect(unit.id)} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
