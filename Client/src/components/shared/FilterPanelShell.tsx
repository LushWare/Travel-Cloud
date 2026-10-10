import { useEffect, useState, type ReactNode } from 'react';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';

interface FilterPanelShellProps {
  children: ReactNode;
  /** Fired when the mobile drawer is dismissed (backdrop click, Escape, close button). */
  onClose: () => void;
  /** Render the drawer even when the viewport reports desktop layout. */
  forceMobile?: boolean;
  /** Accessible name for the mobile drawer; not rendered visually. */
  title?: string;
}

/**
 * Shared responsive wrapper for the packages and destinations filter
 * sidebars, kept in one place because both pages' FiltersSidebar.tsx
 * previously duplicated this wrapper.
 *
 * Mobile/tablet (<1024px): a real shadcn `Sheet` drawer — slide-in panel in a
 * portal with its own backdrop, so nothing bleeds around the drawer's edges
 * and the page behind is properly scrimmed.
 *
 * Desktop (>=1024px, the `lg:` breakpoint): a plain static column that sticks
 * below the 70px site header (see Header.tsx's `h-[70px]`) and scrolls
 * internally only when its content is genuinely taller than the viewport,
 * via a single consistent `max-h-[calc(100vh-70px)]` — no forced `h-`-based
 * scrollboxes.
 *
 * The previous wrapper switched to the static column at `2xl:` (1536px), so
 * real laptop widths (1366-1440px) fell into the drawer treatment: a fixed
 * panel with a hand-rolled backdrop, content bleeding around its edges, and
 * an internal scrollbar alongside the page scrollbar (finding #1 of
 * docs/CLIENT-REWAMP-PLAN.md). `lg:` puts every laptop on the column.
 */
const DESKTOP_BREAKPOINT = '(min-width: 1024px)';

function useIsDesktopLayout(): boolean {
  const [isDesktop, setIsDesktop] = useState(() => {
    // Real browsers always expose matchMedia; the innerWidth fallback keeps
    // jsdom-based tests deterministic (jsdom's default viewport is 1024px).
    if (typeof window.matchMedia === 'function') {
      return window.matchMedia(DESKTOP_BREAKPOINT).matches;
    }
    return window.innerWidth >= 1024;
  });

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mediaQuery = window.matchMedia(DESKTOP_BREAKPOINT);
    const handleChange = (event: MediaQueryListEvent) => setIsDesktop(event.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  return isDesktop;
}

export default function FilterPanelShell({
  children,
  onClose,
  forceMobile = false,
  title = 'Filters',
}: FilterPanelShellProps) {
  const isDesktop = useIsDesktopLayout();

  if (isDesktop && !forceMobile) {
    // In-flow card per Client/DESIGN.md elevation: hairline border + the card
    // radius (rounded-2xl / --radius-card), no resting shadow.
    return (
      <div className="w-72 shrink-0 self-start sticky top-[70px] max-h-[calc(100vh-70px)] overflow-y-auto rounded-2xl border border-gray-200 bg-white p-4 md:p-6">
        {children}
      </div>
    );
  }

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent
        side="left"
        showCloseButton={false}
        className="inset-y-0 top-0 bottom-0 left-0 right-auto w-[88vw] data-[side=left]:!w-[88vw] max-w-sm gap-0 overflow-y-auto bg-white p-4 sm:p-6"
      >
        <SheetTitle className="sr-only">{title}</SheetTitle>
        {children}
      </SheetContent>
    </Sheet>
  );
}
