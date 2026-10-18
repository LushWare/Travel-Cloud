import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '../../contexts/ThemeContext';
import AppearanceToggle from '../AppearanceToggle';

function renderToggle(props: { collapsed?: boolean } = {}) {
  return render(
    <ThemeProvider>
      <AppearanceToggle {...props} />
    </ThemeProvider>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove('dark');
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    media: '(prefers-color-scheme: dark)',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
});

describe('AppearanceToggle', () => {
  it('renders System, Light, and Dark options', () => {
    renderToggle();

    expect(screen.getByRole('radio', { name: 'System' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Light' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeInTheDocument();
  });

  it('marks System as checked when no preference is stored', () => {
    renderToggle();

    expect(screen.getByRole('radio', { name: 'System' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Light' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'false');
  });

  it('marks Dark as checked when dark is the stored preference', () => {
    window.localStorage.setItem('management-theme', 'dark');
    renderToggle();

    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
  });

  it('switches the active option to Dark when Dark is clicked', async () => {
    const user = userEvent.setup();
    renderToggle();

    await user.click(screen.getByRole('radio', { name: 'Dark' }));

    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'System' })).toHaveAttribute('aria-checked', 'false');
    expect(window.localStorage.getItem('management-theme')).toBe('dark');
  });

  it('stacks the options vertically in nav-sized icon buttons when collapsed', () => {
    renderToggle({ collapsed: true });

    expect(screen.getByRole('radiogroup')).toHaveClass('flex-col', 'items-center');
    for (const label of ['System', 'Light', 'Dark']) {
      expect(screen.getByRole('radio', { name: label })).toHaveClass('h-9', 'w-9');
    }
  });

  it('lays the options out horizontally when not collapsed', () => {
    renderToggle();

    expect(screen.getByRole('radiogroup')).toHaveClass('flex-row');
  });
});
