import { Check } from 'lucide-react';

export interface StepperStep {
  label: string;
}

interface StepperProps {
  steps: StepperStep[];
  /** 1-indexed: matches every container's existing `useState(1)` step convention. */
  currentStep: number;
  className?: string;
}

/**
 * Shared step indicator for the Phase 4 booking/planner flows (`BookingModal`,
 * `PlanYourTripContainer`, `CustomizePackageContainer`) — one visual treatment
 * on brand tokens, replacing three separately hand-rolled numbered-circle
 * implementations (one of them gold-accented, a DESIGN.md-flagged violation).
 * Solid `brand-600` for the active/completed dot and connector, `brand-100`
 * step-tile tint is intentionally not used here (this is a dot, not a tile).
 */
export default function Stepper({ steps, currentStep, className = '' }: StepperProps) {
  return (
    <ol className={`flex w-full min-w-0 items-start ${className}`} aria-label="Progress">
      {steps.map((step, index) => {
        const stepNumber = index + 1;
        const isComplete = currentStep > stepNumber;
        const isActive = currentStep === stepNumber;
        return (
          <li
            key={step.label}
            className="flex min-w-0 items-start"
            style={{ flex: stepNumber < steps.length ? '1 1 0%' : '0 0 auto' }}
            aria-current={isActive ? 'step' : undefined}
          >
            <div className="flex flex-col items-center">
              <div
                className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center font-semibold text-sm transition-colors ${
                  isComplete || isActive
                    ? 'bg-brand-600 text-white'
                    : 'bg-gray-200 text-gray-500'
                }`}
              >
                {isComplete ? <Check className="w-4 h-4 sm:w-5 sm:h-5" aria-hidden="true" /> : stepNumber}
              </div>
              <span
                className={`mt-1.5 w-full min-w-0 break-words text-center text-[10px] font-medium leading-tight sm:whitespace-nowrap sm:text-xs ${
                  isComplete || isActive ? 'text-gray-900' : 'text-gray-400'
                }`}
              >
                {step.label}
              </span>
            </div>
            {stepNumber < steps.length && (
              <div
                className={`flex-1 h-0.5 mx-2 sm:mx-3 mt-4 sm:mt-5 rounded-full transition-colors ${
                  isComplete ? 'bg-brand-600' : 'bg-gray-200'
                }`}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
