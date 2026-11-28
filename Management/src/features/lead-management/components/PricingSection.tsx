import { useState, useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { leadAPI } from '../../../services/api';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

const money = (n: number | string | null | undefined) =>
  `$${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface PricingSettings {
  marginType: string | null;
  marginValue: number;
  depositType: string;
  depositValue: number;
  discountType: string;
  discountValue: number;
  serviceChargeRate: number;
  /** This package's own tax %; '' = use the Settings default rate. */
  taxRate: number | '';
}

interface PricingSectionProps {
  leadId?: string;
  selectionId?: string;
  days?: any[];
  travelers?: number;
  pricing?: Partial<PricingSettings>;
  onSettingsChange?: (settings: PricingSettings) => void;
  refreshToken?: number;
}

const MARGIN_TYPE_LABELS: Record<string, string> = { PERCENTAGE: 'Percentage', FIXED: 'Fixed' };
const DISCOUNT_TYPE_LABELS: Record<string, string> = { none: 'None', percentage: '%', fixed: 'Fixed' };
/** A saved tax rate as the input shows it: '' when the package follows Settings. */
const toTaxInput = (value: unknown): number | '' =>
  value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? '' : Number(value);

const DEPOSIT_TYPE_LABELS: Record<string, string> = { PERCENTAGE: '%', FIXED: 'Fixed' };

/**
 * Live pricing card for one package selection's tab in the lead dialog.
 * Preview-only: every change calls the backend engine via
 * /packages/:selectionId/pricing/calculate; nothing persists until the
 * dialog saves { days, pricing } to /packages/:selectionId/itinerary.
 */
export default function PricingSection({ leadId, selectionId, days = [], travelers = 1, pricing = {}, onSettingsChange, refreshToken = 0 }: PricingSectionProps) {
  const initialized = useRef(false);
  const [settings, setSettings] = useState<PricingSettings>({
    marginType: pricing.marginType || null,
    marginValue: Number(pricing.marginValue) || 0,
    depositType: pricing.depositType || 'PERCENTAGE',
    depositValue: Number(pricing.depositValue) || 0,
    discountType: pricing.discountType || 'none',
    discountValue: Number(pricing.discountValue) || 0,
    serviceChargeRate: Number(pricing.serviceChargeRate) || 0,
    taxRate: toTaxInput(pricing.taxRate),
  });
  const [computed, setComputed] = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState(false);

  // Initialize once from the loaded pricing row (never overwrite user edits).
  useEffect(() => {
    if (!initialized.current && pricing && Object.keys(pricing).length > 0) {
      initialized.current = true;
      setSettings({
        marginType: pricing.marginType || null,
        marginValue: Number(pricing.marginValue) || 0,
        depositType: pricing.depositType || 'PERCENTAGE',
        depositValue: Number(pricing.depositValue) || 0,
        discountType: pricing.discountType || 'none',
        discountValue: Number(pricing.discountValue) || 0,
        serviceChargeRate: Number(pricing.serviceChargeRate) || 0,
        taxRate: toTaxInput(pricing.taxRate),
      });
    }
  }, [pricing]);

  const updateSettings = (patch: Partial<PricingSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    onSettingsChange?.(next);
  };

  // Debounced live preview whenever days, settings, or refreshToken change.
  // refreshToken is a manual bump for changes calculatePricing needs to know
  // about but that don't touch days/travelers/settings — e.g. adding, editing
  // or removing a transfer flight, which lives in a persisted LeadOptionalFlight
  // row, not in the itinerary days this component otherwise watches.
  useEffect(() => {
    if (!Array.isArray(days)) return;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const payload = {
          days,
          travelers: Number(travelers) || 1,
          marginType: settings.marginType,
          marginValue: Number(settings.marginValue) || 0,
          discountType: settings.discountType,
          discountValue: Number(settings.discountValue) || 0,
          serviceChargeRate: Number(settings.serviceChargeRate) || 0,
          depositType: settings.depositType,
          depositValue: Number(settings.depositValue) || 0,
          taxRate: settings.taxRate === '' ? null : Number(settings.taxRate),
        };
        const res = leadId && selectionId
          ? await leadAPI.calculateSelectionPricing(leadId, selectionId, payload)
          : await leadAPI.previewPricing(payload);
        setComputed(res.data?.data?.financials || res.data?.financials);
      } catch (err) {
        // keep the last known preview on transient errors
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [leadId, selectionId, days, travelers, settings, refreshToken]);

  const labelCls = 'text-xs text-muted-foreground';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        <div>
          <label className={labelCls}>Margin</label>
          <div className="flex gap-1">
            <Select
              value={settings.marginType ?? '__none__'}
              onValueChange={(value) => updateSettings({ marginType: value === '__none__' ? null : String(value) })}
            >
              <SelectTrigger className="w-full">
                <SelectValue>{(v: string) => (v === '__none__' ? 'None' : MARGIN_TYPE_LABELS[v] ?? v)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None</SelectItem>
                <SelectItem value="PERCENTAGE">Percentage</SelectItem>
                <SelectItem value="FIXED">Fixed</SelectItem>
              </SelectContent>
            </Select>
            <Input type="number" min="0" step="0.01" value={settings.marginValue}
              onChange={(e) => updateSettings({ marginValue: Number(e.target.value) })} />
          </div>
        </div>
        <div>
          <label className={labelCls}>Discount</label>
          <div className="flex gap-1">
            <Select value={settings.discountType} onValueChange={(value) => updateSettings({ discountType: String(value) })}>
              <SelectTrigger className="w-full">
                <SelectValue>{(v: string) => DISCOUNT_TYPE_LABELS[v] ?? v}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="percentage">%</SelectItem>
                <SelectItem value="fixed">Fixed</SelectItem>
              </SelectContent>
            </Select>
            <Input type="number" min="0" step="0.01" value={settings.discountValue}
              onChange={(e) => updateSettings({ discountValue: Number(e.target.value) })} />
          </div>
        </div>
        <div>
          <label className={labelCls} htmlFor="pricing-tax-rate">Tax %</label>
          <Input id="pricing-tax-rate" type="number" min="0" max="100" step="0.01" value={settings.taxRate}
            placeholder={computed ? `Settings: ${Number(computed.taxRate) || 0}%` : 'Settings rate'}
            onChange={(e) => updateSettings({ taxRate: e.target.value === '' ? '' : Number(e.target.value) })} />
        </div>
        <div>
          <label className={labelCls}>Service charge %</label>
          <Input type="number" min="0" step="0.01" value={settings.serviceChargeRate}
            onChange={(e) => updateSettings({ serviceChargeRate: Number(e.target.value) })} />
        </div>
        <div>
          <label className={labelCls}>Deposit/Advance</label>
          <div className="flex gap-1">
            <Select value={settings.depositType} onValueChange={(value) => updateSettings({ depositType: String(value) })}>
              <SelectTrigger className="w-full">
                <SelectValue>{(v: string) => DEPOSIT_TYPE_LABELS[v] ?? v}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PERCENTAGE">%</SelectItem>
                <SelectItem value="FIXED">Fixed</SelectItem>
              </SelectContent>
            </Select>
            <Input type="number" min="0" step="0.01" value={settings.depositValue}
              onChange={(e) => updateSettings({ depositValue: Number(e.target.value) })} />
          </div>
        </div>
      </div>

      {loading && !computed && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Calculating…
        </div>
      )}

      {computed && (
        <div className="bg-muted rounded-lg p-3 space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Estimated cost:</span><span className="font-medium">{money(computed.estimatedTotal)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Sell subtotal:</span><span className="font-medium">{money(computed.sellSubtotal)}</span></div>
          {Number(computed.discountAmount) > 0 && (
            <div className="flex justify-between"><span className="text-muted-foreground">Discount:</span><span className="font-medium text-destructive">−{money(computed.discountAmount)}</span></div>
          )}
          <div className="flex justify-between"><span className="text-muted-foreground">Tax ({Number(computed.taxRate) || 0}%):</span><span className="font-medium">{money(computed.taxAmount)}</span></div>
          {Number(computed.serviceChargeAmount) > 0 && (
            <div className="flex justify-between"><span className="text-muted-foreground">Service charge:</span><span className="font-medium">{money(computed.serviceChargeAmount)}</span></div>
          )}
          <div className="flex justify-between border-t border-border pt-1">
            <span className="text-foreground font-semibold">Total:</span>
            <span className="font-semibold text-primary">{money(computed.totalAmount)}</span>
          </div>
          <div className="flex justify-between"><span className="text-muted-foreground">Deposit/Advance:</span><span className="font-medium text-warning">{money(computed.depositAmount)}</span></div>
          {computed.paidAmount != null && (
            <div className="flex justify-between"><span className="text-muted-foreground">Paid / Balance:</span><span className="font-medium">{money(computed.paidAmount)} / {money(computed.balanceDue)}</span></div>
          )}
          {computed.profit != null && (
            <div className={`flex justify-between ${computed.profit >= 0 ? 'text-success' : 'text-destructive'}`}>
              <span>Profit:</span><span className="font-semibold">{money(computed.profit)}</span>
            </div>
          )}
        </div>
      )}
      {!computed && !loading && (
        <p className="text-xs text-muted-foreground">Pricing preview appears here once an itinerary exists.</p>
      )}
    </div>
  );
}
