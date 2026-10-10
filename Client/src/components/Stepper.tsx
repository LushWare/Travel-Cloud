import { Check } from 'lucide-react';

export interface StepperStep {
  label: string;
}

interface StepperProps {
  steps: StepperStep[];
  currentStep: number;
  className?: string;
}

export default function Stepper({ steps, currentStep, className = '' }: StepperProps) {
  return (
    <ol className={`flex w-full min-w-0 items-start sm:min-w-[auto] ${className}`} aria-label="Progress">
      {steps.map((step, index) => {
        const stepNumber = index + 1;
        const isComplete = currentStep > stepNumber;
        const isActive = currentStep === stepNumber;
        return (
          <li
            key={step.label}
            className="flex min-w-0 items-start sm:min-w-[auto]"
            style={{ flex: stepNumber < steps.length ? '1 1 0%' : '0 0 auto' }}
            aria-current={isActive ? 'step' : undefined}
          >
            <div className="flex w-full min-w-0 flex-col items-center sm:w-auto sm:min-w-[auto]">
              <div
                className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full border-2 flex items-center justify-center font-semibold text-sm transition-colors ${
                  isComplete || isActive
                    ? 'border-brand-600 bg-brand-600 text-white'
                    : 'border-gray-300 bg-white text-gray-500'
                }`}
              >
                {isComplete ? <Check className="w-4 h-4 sm:w-5 sm:h-5" aria-hidden="true" /> : stepNumber}
              </div>
              <span
                className={`mt-1.5 w-full min-w-0 break-words text-center text-xs font-medium leading-tight sm:w-auto sm:min-w-[auto] sm:whitespace-nowrap sm:break-normal sm:leading-normal ${
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
