import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface RangeOption {
  label: string;
  min: number;
  max: number;
}

interface RangeFilterGroupProps {
  /** Group heading, e.g. "Budget" or "Trip Duration". */
  label: string;
  /**
   * Optional leading icon next to the heading (a lucide icon, e.g.
   * `<Banknote />` or `<Clock />`). Sized/colored by the component so both
   * existing FiltersSidebar call sites keep their current look.
   */
  icon?: ReactNode;
  /** Range choices rendered as a labeled checkbox list. */
  options: RangeOption[];
  /** Currently selected option, or null when nothing is selected. */
  selected: RangeOption | null;
  /**
   * Called with the clicked option, or with null when the already-selected
   * option is clicked again (single-select-toggle, not multi-select — the
   * checkbox is a visual affordance only).
   */
  onChange: (value: RangeOption | null) => void;
  className?: string;
}

/**
 * A labeled group of range options rendered as clickable checkbox rows with
 * single-select-toggle behavior: clicking an option selects it exclusively;
 * clicking the selected option again clears the selection. Extracted from
 * the identical hand-rolled price/duration blocks previously duplicated in
 * the destinations and packages FiltersSidebar copies (Phase 0 of
 * docs/CLIENT-REWAMP-PLAN.md); the caller owns `selected`/`onChange` state.
 * Each row is a `<label>` so the whole row toggles, matching the original
 * pattern the shadcn Checkbox primitive replaces.
 */
export default function RangeFilterGroup({
  label,
  icon,
  options,
  selected,
  onChange,
  className,
}: RangeFilterGroupProps) {
  return (
    <div className={cn('mb-6', className)}>
      <h4 className="font-semibold mb-3 flex items-center gap-2">
        {icon && (
          <span aria-hidden="true" className="shrink-0 text-gray-600 [&_svg]:size-4">
            {icon}
          </span>
        )}
        <span className="text-gray-900">{label}</span>
      </h4>
      <div className="space-y-2">
        {options.map((option) => {
          const isSelected = selected?.label === option.label;
          return (
            <label
              key={option.label}
              className={`group flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 transition-colors ${
                isSelected ? 'bg-emerald-50' : 'hover:bg-slate-50'
              }`}
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => onChange(isSelected ? null : option)}
                className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-emerald-700 focus:ring-emerald-500"
              />
              <span
                className={`text-base transition-colors ${
                  isSelected
                    ? 'font-medium text-emerald-900'
                    : 'text-slate-600 group-hover:text-slate-900'
                }`}
              >
                {option.label}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
