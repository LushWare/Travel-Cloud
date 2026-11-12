import type { ReactNode } from 'react';

export const BrandMark = ({ className = 'h-10 w-10' }: { className?: string }) => (
  <span className={`flex shrink-0 items-center justify-center rounded-lg bg-primary font-heading text-sm font-extrabold text-primary-foreground ${className}`}>
    LTC
  </span>
);

type Props = { title: string; subtitle: string; children: ReactNode };

/** The same centred brand + bordered card frame Management's sign-in pages use. */
export default function AuthCard({ title, subtitle, children }: Props) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mb-2 flex items-center justify-center gap-3">
            <BrandMark />
            <span className="font-heading text-xl font-bold text-foreground">Lush Console</span>
          </div>
          <p className="text-sm text-muted-foreground">Platform administration · Lushware staff only</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-6 sm:p-8">
          <div className="mb-6 text-center">
            <h1 className="font-heading text-xl font-semibold text-foreground">{title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          </div>
          {children}
        </div>
      </div>
    </main>
  );
}

export const FormError = ({ message }: { message: string }) =>
  (message ? <p role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{message}</p> : null);
