/**
 * Transport Row Editor Component
 * One independently configurable transport row (mode, pricing model,
 * unit cost, optional distance) used by the Costs & Pricing subsection.
 */

import { Car, TrendingUp, Trash2 } from 'lucide-react';
import {
  applyTransportModeDefault,
  applyPricingModelChange,
  TRANSPORT_MODE_LABELS,
  PRICING_MODEL_LABELS,
} from '@travel-crm/constants';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface TransportRowEditorProps {
  transport: any;
  onChange: (patch: any) => void;
  onRemove: (index: number) => void;
  index: number;
}

const PRICE_LABELS: Record<string, string> = {
  PER_VEHICLE: 'Price per vehicle',
  PER_KM: 'Price per km',
  PER_PERSON: 'Price per person',
};

const TransportRowEditor = ({ transport, onChange, onRemove, index }: TransportRowEditorProps) => {
  const row = transport || {};
  const isPerKm = row.pricingModel === 'PER_KM';

  return (
    <div className="bg-muted rounded-lg border border-border px-3 py-2">
      <div className="flex flex-wrap items-end gap-2">
        {/* Mode */}
        <div className="min-w-[130px] flex-1">
          <label className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
            <Car className="w-3 h-3" /> Mode
          </label>
          <Select
            value={row.transportMode || 'CAR'}
            onValueChange={(value) => onChange(applyTransportModeDefault(row, String(value)))}
          >
            <SelectTrigger className="w-full">
              <SelectValue>{(value: string) => (TRANSPORT_MODE_LABELS as Record<string, string>)[value] ?? value}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {Object.entries(TRANSPORT_MODE_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>{label as string}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Pricing model */}
        <div className="min-w-[130px] flex-1">
          <label className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
            <TrendingUp className="w-3 h-3" /> Pricing
          </label>
          <Select
            value={row.pricingModel || 'PER_VEHICLE'}
            onValueChange={(value) => onChange(applyPricingModelChange(row, String(value)))}
          >
            <SelectTrigger className="w-full">
              <SelectValue>{(value: string) => (PRICING_MODEL_LABELS as Record<string, string>)[value] ?? value}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {Object.entries(PRICING_MODEL_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>{label as string}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Price for the chosen pricing */}
        <div className="w-36">
          <label htmlFor={`transport-${index}-price`} className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
            {PRICE_LABELS[row.pricingModel] ?? 'Price'}
          </label>
          <Input
            id={`transport-${index}-price`}
            type="number"
            min="0"
            step="0.01"
            value={row.unitCost ?? ''}
            placeholder="0"
            onChange={(e) => onChange({ unitCost: e.target.value === '' ? 0 : (parseFloat(e.target.value) || 0) })}
            onWheel={(e) => e.currentTarget.blur()}
          />
        </div>

        {/* Distance — only meaningful for PER_KM */}
        {isPerKm && (
          <div className="w-28">
            <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Distance (km)</label>
            <Input
              type="number"
              min="0"
              step="0.1"
              value={row.distanceKm ?? ''}
              placeholder="0"
              onChange={(e) => onChange({ distanceKm: e.target.value === '' ? null : (parseFloat(e.target.value) || 0) })}
              onWheel={(e) => e.currentTarget.blur()}
            />
          </div>
        )}

        {/* Remove */}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onRemove(index)}
          title="Remove transport"
          aria-label="Remove transport"
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
};

export default TransportRowEditor;
