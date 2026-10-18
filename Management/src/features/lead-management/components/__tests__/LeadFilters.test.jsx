import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LeadFilters from '../LeadFilters';
import FilterDialog from '../FilterDialog';

function renderFilters(props = {}) {
  return render(
    <LeadFilters
      searchTerm=""
      setSearchTerm={vi.fn()}
      filterStatus="all"
      setFilterStatus={vi.fn()}
      statusCounts={{}}
      onAdvancedFilterClick={vi.fn()}
      onClearFilters={vi.fn()}
      activeFilterCount={0}
      {...props}
    />
  );
}

describe('LeadFilters — PENDING_VERIFICATION', () => {
  it('includes PENDING_VERIFICATION as a selectable status filter tab', async () => {
    const user = userEvent.setup();
    const setFilterStatus = vi.fn();
    renderFilters({ setFilterStatus });

    const tab = screen.getByRole('tab', { name: /pending verification/i });
    expect(tab).toBeInTheDocument();

    await user.click(tab);
    expect(setFilterStatus).toHaveBeenCalledWith('PENDING_VERIFICATION');
  });
});

describe('LeadFilters — compact bar', () => {
  it('opens the unified popup and omits a platform filter from the bar', async () => {
    const user = userEvent.setup();
    const onAdvancedFilterClick = vi.fn();
    renderFilters({ onAdvancedFilterClick, activeFilterCount: 2 });

    expect(screen.queryByRole('button', { name: 'Platform' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /filters 2/i }));
    expect(onAdvancedFilterClick).toHaveBeenCalledOnce();
  });

  it('clears all active filters directly from after the status tabs', async () => {
    const user = userEvent.setup();
    const onClearFilters = vi.fn();
    renderFilters({
      filterStatus: 'CLOSED_LOST',
      searchTerm: 'Alex',
      activeFilterCount: 2,
      onClearFilters,
    });

    const clearButton = screen.getByRole('button', { name: 'Clear all filters' });
    expect(clearButton).toBeEnabled();
    expect(clearButton).toHaveClass('bg-destructive', 'text-black', 'dark:text-white', 'hover:bg-destructive/90', 'hover:text-black', 'dark:hover:text-white');
    await user.click(clearButton);

    expect(onClearFilters).toHaveBeenCalledOnce();
  });

  it('disables Clear when no filters are active', () => {
    renderFilters();

    const clearButton = screen.getByRole('button', { name: 'Clear all filters' });
    expect(clearButton).toBeDisabled();
    expect(clearButton).toHaveClass('disabled:bg-destructive/30', 'disabled:text-black', 'disabled:opacity-100', 'dark:disabled:text-white');
  });
});

describe('FilterDialog — source and voice-agent filters', () => {
  const renderDialog = (overrides = {}) => render(
    <FilterDialog
      isOpen
      onClose={vi.fn()}
      filterTravelDateStart=""
      setFilterTravelDateStart={vi.fn()}
      filterTravelDateEnd=""
      setFilterTravelDateEnd={vi.fn()}
      filterSources={[]}
      setFilterSources={vi.fn()}
      filterAi={[]}
      setFilterAi={vi.fn()}
      {...overrides}
    />
  );

  it('provides a source filter without duplicate platform options', () => {
    renderDialog();

    expect(screen.getByRole('button', { name: 'Booking' })).toBeInTheDocument();
    expect(screen.queryByText('Platform')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Social' })).not.toBeInTheDocument();
  });

  it('toggles source and voice-agent filters', async () => {
    const user = userEvent.setup();
    const setFilterSources = vi.fn();
    const setFilterAi = vi.fn();
    renderDialog({ setFilterSources, setFilterAi });

    await user.click(screen.getByRole('button', { name: 'Booking' }));
    await user.click(screen.getByRole('button', { name: 'AI handled' }));
    expect(setFilterSources).toHaveBeenCalledWith(['booking']);
    expect(setFilterAi).toHaveBeenCalledWith(['aiHandled']);
  });

  it('clears source, voice-agent, and date filters together', async () => {
    const user = userEvent.setup();
    const setFilterTravelDateStart = vi.fn();
    const setFilterTravelDateEnd = vi.fn();
    const setFilterSources = vi.fn();
    const setFilterAi = vi.fn();
    renderDialog({
      filterTravelDateStart: '2026-10-01',
      filterTravelDateEnd: '2026-10-31',
      filterSources: ['booking'],
      filterAi: ['aiHandled'],
      setFilterTravelDateStart,
      setFilterTravelDateEnd,
      setFilterSources,
      setFilterAi,
    });

    await user.click(screen.getByRole('button', { name: 'Clear All' }));

    expect(setFilterTravelDateStart).toHaveBeenCalledWith('');
    expect(setFilterTravelDateEnd).toHaveBeenCalledWith('');
    expect(setFilterSources).toHaveBeenCalledWith([]);
    expect(setFilterAi).toHaveBeenCalledWith([]);
  });
});
