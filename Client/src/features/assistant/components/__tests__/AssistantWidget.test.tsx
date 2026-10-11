import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { formatCurrency } from '../../../../lib/currency';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import AssistantWidget from '../AssistantWidget';
import FloatingActionStack from '../../../../components/shared/floating-actions/FloatingActionStack';
import {
  setAssistantLauncherOpen,
  getAssistantLauncherOpen,
} from '../../../../components/shared/floating-actions/assistantLauncherState';

const mockSendAssistantTurn = vi.hoisted(() => vi.fn());
const mockSendAssistantEvent = vi.hoisted(() => vi.fn());
const mockLoadAssistantParamValues = vi.hoisted(() => vi.fn());

vi.mock('../../../../services/api/assistantTurn', () => ({
  sendAssistantTurn: mockSendAssistantTurn,
}));

vi.mock('../../../../services/api/assistantEvents', () => ({
  sendAssistantEvent: mockSendAssistantEvent,
}));

// `sendMessage` loads the destination vocabulary before every turn. Left real,
// each send here reaches the network from jsdom: the module swallows the
// failure so nothing asserted wrongly, but the attempt made these tests
// timing-dependent and they failed intermittently under parallel load.
vi.mock('../../assistantParamValues', () => ({
  loadAssistantParamValues: mockLoadAssistantParamValues,
}));

// The widget reads the mounted page's registration through this module. Mocked
// rather than provided, so a test can hand the hook any registration it likes
// without rendering a page: `mockPageRegistration.current` is what the hook's
// getter returns.
const mockPageRegistration = vi.hoisted(() => ({ current: null as unknown }));
// What the mounted page reported is on screen, for the same reason: a getter the
// test can point at a page that counts, or at nothing.
const mockCurrentView = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('../../capabilities/AssistantCapabilityProvider', () => ({
  useAssistantCapabilities: () => () => mockPageRegistration.current,
  useAssistantPageRegistration: vi.fn(),
  useAssistantCurrentView: () => () => mockCurrentView.current,
  // False here: the panel's layer only follows a dialog-hosted form, and these
  // tests exercise the ordinary page case.
  useAssistantDialogHost: () => false,
}));

// The search string is included because a handoff lands on
// `/package/<id>?book=1`, and the query is the whole of what opens the booking
// form on the other side.
const LocationProbe = () => {
  const location = useLocation();
  return <div data-testid="location-probe">{`${location.pathname}${location.search}`}</div>;
};

// Simulates the router-level navigation the widget doesn't control itself
// (e.g. an email link to /login, a bookmark to /planner) so a test can drive
// the widget through a route change without going via one of its own chips.
const NavTo = ({ to }: { to: string }) => {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(to)}>
      go-to-{to}
    </button>
  );
};

const renderWidget = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <AssistantWidget />
              <LocationProbe />
              <NavTo to="/planner" />
              <NavTo to="/packages" />
              {/* An excluded route, for the test that drives the widget through
                  one and back: /planner used to be the example, and is not one
                  any more. */}
              <NavTo to="/my-account" />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );

// Phase 1: AssistantWidget has no launcher of its own — the FloatingActionStack
// anchor's "Travel assistant" item is the only way the panel opens, and it
// opens through the shared store. These tests drive that same seam directly;
// the anchor→row→panel click path itself is covered by the launcher
// integration test below (real FloatingActionStack + real AssistantWidget).
const openPanel = () => {
  act(() => {
    setAssistantLauncherOpen(true);
  });
};

const renderLauncherAndWidget = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <FloatingActionStack />
              <AssistantWidget />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );

const eventsOf = (eventType: string) => mockSendAssistantEvent.mock.calls.filter(([payload]) => payload.eventType === eventType);

const dialog = () => screen.queryByRole('dialog', { name: 'Travel assistant panel' });
const sendButton = () => screen.getByRole('button', { name: 'Send message' });
const input = () => screen.getByPlaceholderText('Ask about travel, pages, or policies…');

beforeEach(() => {
  mockSendAssistantTurn.mockReset();
  mockSendAssistantEvent.mockReset();
  mockCurrentView.current = null;
  mockLoadAssistantParamValues.mockReset();
  mockLoadAssistantParamValues.mockResolvedValue({
    packages: { destination: [{ value: 'uae', label: 'Dubai' }] },
  });
  setAssistantLauncherOpen(false);
  localStorage.clear();
});

afterEach(() => {
  setAssistantLauncherOpen(false);
});

describe('AssistantWidget', () => {
  it.each(['/', '/packages'])('renders no panel on the public browsing route %s until the launcher opens it', (path) => {
    renderWidget(path);
    expect(dialog()).not.toBeInTheDocument();
    expect(getAssistantLauncherOpen()).toBe(false);
  });

  it.each([
    '/login',
    '/login/', // trailing slash must still match — React Router treats it as the same route
    '/my-account',
    '/my-account/',
  ])('renders nothing on the excluded route %s', (path) => {
    renderWidget(path);
    expect(dialog()).not.toBeInTheDocument();
    expect(mockSendAssistantEvent).not.toHaveBeenCalled();
  });

  it.each(['/planner', '/planner/', '/package/123/customize', '/package/123/customize/'])(
    'mounts on the assistant-enabled planner/customize route %s',
    (path) => {
      renderWidget(path);

      // No panel until the launcher opens it, exactly as on every other page —
      // and the impression event proves the widget did not self-exclude.
      expect(dialog()).not.toBeInTheDocument();
      expect(eventsOf('impression')).toHaveLength(1);
    },
  );

  it('fires exactly one impression event on mount on an eligible route', () => {
    renderWidget('/');
    expect(eventsOf('impression')).toHaveLength(1);
    expect(eventsOf('impression')[0][0]).toMatchObject({ eventType: 'impression', tool: null, route: null });
    expect(eventsOf('impression')[0][0].sessionId).toBeTruthy();
  });

  it('opens the panel while the launcher store is open and fires the opened event once per mount', async () => {
    renderWidget('/');
    const user = userEvent.setup();

    openPanel();
    expect(eventsOf('opened')).toHaveLength(1);
    expect(dialog()).toBeInTheDocument();
    expect(input()).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Close assistant panel' }));
    expect(dialog()).not.toBeInTheDocument();
    expect(getAssistantLauncherOpen()).toBe(false);

    openPanel();
    expect(eventsOf('opened')).toHaveLength(1);
    expect(dialog()).toBeInTheDocument();
  });

  it('renders the panel bottom-right, floating above the launcher anchor', () => {
    renderWidget('/');
    openPanel();
    const wrapper = dialog()?.parentElement as HTMLElement;
    expect(wrapper).toHaveClass('right-3');
    expect(wrapper).not.toHaveClass('left-3');
    // Anchor bottom edge is 16px, anchor is 64px tall, 12px gap — the panel
    // clears the anchor at 92px instead of covering it.
    expect(wrapper).toHaveStyle({ bottom: '92px' });
  });

  it('does not trap page scrolling when the transcript has no overflow', () => {
    renderWidget('/');
    openPanel();

    const transcript = dialog()?.querySelector('.overflow-y-auto');
    expect(transcript).not.toHaveAttribute('data-lenis-prevent');
  });

  it('shows what the page did under the reply, and only once the page has done it', async () => {
    let resolveAction: (line: string) => void = () => {};
    mockPageRegistration.current = {
      surface: 'planner',
      revision: 'planner',
      pageContext: { surface: 'planner', revision: 'planner', step: 3 },
      actions: ['edit_day'],
      runAction: vi.fn(() => new Promise<string>((resolve) => { resolveAction = resolve; })),
    };
    mockSendAssistantTurn.mockResolvedValue({
      toolCall: { tool: 'edit_day', args: { dayNumber: 3, operation: 'add_activities', values: ['whale watching'] } },
      serverResult: {
        action: { tool: 'edit_day', dayNumber: 3, operation: 'add_activities', values: ['whale watching'] },
        revision: 'planner',
        surface: 'planner',
      },
      message: 'Updating that day now.',
    });

    renderWidget('/planner');
    const user = userEvent.setup();
    openPanel();
    await user.type(input(), 'add whale watching to day 3');
    await user.click(sendButton());

    // The page is still working: the bubble claims nothing yet.
    expect(await screen.findByText('Updating that day now.')).toBeInTheDocument();
    expect(screen.queryByText('Updated Day 3: activities.')).not.toBeInTheDocument();

    await act(async () => {
      resolveAction('Updated Day 3: activities.');
    });

    expect(await screen.findByText('Updated Day 3: activities.')).toBeInTheDocument();
  });

  it('says so when there is no page that can run the action', async () => {
    mockPageRegistration.current = null;
    mockSendAssistantTurn.mockResolvedValue({
      toolCall: { tool: 'edit_day', args: { dayNumber: 3, operation: 'add_activities', values: ['whale watching'] } },
      serverResult: { action: { tool: 'edit_day', dayNumber: 3 }, revision: null, surface: null },
      message: 'Updating that day now.',
    });

    renderWidget('/packages');
    const user = userEvent.setup();
    openPanel();
    await user.type(input(), 'add whale watching to day 3');
    await user.click(sendButton());

    expect(
      await screen.findByText('I can only change the trip on the trip planner and the customize pages — open one and ask me there.'),
    ).toBeInTheDocument();
    expect(input()).toHaveFocus();
  });

  it('renders the page\u2019s own count and its filters under a view answer', async () => {
    mockSendAssistantTurn.mockResolvedValue({
      toolCall: { tool: 'answer_current_view', args: {} },
      serverResult: {
        view: {
          path: '/packages',
          params: { destination: 'uae', priceMax: '1500' },
          filteredCount: 3,
          renderedCount: 2,
          catalogueTotal: 25,
        },
      },
      message: 'There are 3 trips matching the filters on this page. 2 are shown so far.',
    });

    renderWidget('/packages?destination=uae&priceMax=1500');
    const user = userEvent.setup();
    openPanel();
    await user.type(input(), 'how many are showing?');
    await user.click(sendButton());

    // The figure is the page's count, not the rendered page size — and the
    // qualifier says so rather than letting 3 read as "and that is all".
    expect(await screen.findByText('3')).toBeInTheDocument();
    expect(screen.getByText('Destination: uae')).toBeInTheDocument();
    // Through the site's own formatter, so the assertion cannot pin a currency
    // the app formats differently.
    expect(screen.getByText(`Under ${formatCurrency(1500)}`)).toBeInTheDocument();
    expect(screen.getByText('2 shown so far')).toBeInTheDocument();
  });

  it('renders no summary block when the answer carried no numbers and no filters', async () => {
    mockSendAssistantTurn.mockResolvedValue({
      toolCall: { tool: 'answer_current_view', args: {} },
      serverResult: { view: null },
      message: "I can't see the page you're on right now.",
    });

    renderWidget('/packages');
    const user = userEvent.setup();
    openPanel();
    await user.type(input(), 'what am I looking at?');
    await user.click(sendButton());

    expect(await screen.findByText("I can't see the page you're on right now.")).toBeInTheDocument();
    expect(screen.queryByText('shown so far')).not.toBeInTheDocument();
  });

  it('renders a grounded answer\u2019s sources as links and refuses a non-link citation', async () => {
    mockSendAssistantTurn.mockResolvedValue({
      toolCall: { tool: 'search_travel_info', args: { query: 'best time to visit Kandy' } },
      serverResult: {
        searched: true,
        query: 'best time to visit Kandy',
        citations: [
          { title: 'example.com', uri: 'https://example.com/kandy-weather' },
          { title: 'not a link', uri: 'javascript:alert(1)' },
        ],
      },
      message: 'December to March is the driest stretch.',
    });

    renderWidget('/packages');
    const user = userEvent.setup();
    openPanel();
    await user.type(input(), 'best time to visit Kandy?');
    await user.click(sendButton());

    const source = await screen.findByRole('link', { name: 'example.com' });
    expect(source).toHaveAttribute('href', 'https://example.com/kandy-weather');
    expect(source).toHaveAttribute('target', '_blank');
    expect(source).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.queryByRole('link', { name: 'not a link' })).not.toBeInTheDocument();
  });

  it('a booking handoff renders a chip that opens the booking form for that package', async () => {
    mockSendAssistantTurn.mockResolvedValue({
      toolCall: { tool: 'hand_off', args: { kind: 'booking', packageId: 'p-bali', message: 'On the way.' } },
      serverResult: { handoff: { kind: 'booking', packageId: 'p-bali', title: 'Bali Honeymoon Bliss' } },
      message: 'I can take you to the booking form for Bali Honeymoon Bliss.',
    });

    renderWidget('/packages');
    const user = userEvent.setup();
    openPanel();
    await user.type(input(), 'book it');
    await user.click(sendButton());

    const chip = await screen.findByRole('button', { name: 'Book this package' });
    await user.click(chip);

    // The client builds this URL from the id the server resolved — the server
    // never returns a package path, for the same reason the package card's
    // `/package/<id>` is built here.
    expect(screen.getByTestId('location-probe').textContent).toBe('/package/p-bali?book=1');
  });

  it('a booking awaiting confirmation offers a one-tap send of the visitor\'s yes', async () => {
    mockSendAssistantTurn.mockResolvedValue({
      toolCall: { tool: 'request_booking', args: { packageId: 'p-bali', message: 'Ready.' } },
      serverResult: { booking: { status: 'awaiting_confirmation', draft: { title: 'Bali Honeymoon Bliss' } } },
      message:
        'Ready to send a booking request: Bali Honeymoon Bliss, 2 travellers, departing 14 Mar 2027, confirmation to ana@example.com. Reply "yes" and I will send it.',
    });

    renderWidget('/packages');
    const user = userEvent.setup();
    openPanel();
    await user.type(input(), 'book it');
    await user.click(sendButton());

    const chip = await screen.findByRole('button', { name: 'Send booking request' });
    await user.click(chip);

    // The chip sends an ordinary user turn rather than calling the server
    // directly, so the confirmation is still something the visitor said — and
    // this is the literal the server's affirmation pattern matches.
    await waitFor(() => expect(mockSendAssistantTurn).toHaveBeenCalledTimes(2));
    expect(mockSendAssistantTurn.mock.calls[1][0].messages.at(-1).content).toBe('Yes, send it');
  });

  it('a booking that needs details or is already sent offers no chip', async () => {
    mockSendAssistantTurn.mockResolvedValue({
      toolCall: { tool: 'request_booking', args: { packageId: 'p-bali', message: 'I need your email.' } },
      serverResult: { booking: { status: 'needs_details', missing: ['email'] } },
      message: 'I can send a booking request for Bali Honeymoon Bliss. I still need the email address to confirm it to.',
    });

    renderWidget('/packages');
    const user = userEvent.setup();
    openPanel();
    await user.type(input(), 'book it');
    await user.click(sendButton());

    await screen.findByText(/I still need the email address/);
    expect(screen.queryByRole('button', { name: 'Send booking request' })).not.toBeInTheDocument();
  });

  it('a human handoff renders the contact chip instead', async () => {
    mockSendAssistantTurn.mockResolvedValue({
      toolCall: { tool: 'hand_off', args: { kind: 'human', message: 'Sure.' } },
      serverResult: { handoff: { kind: 'human' } },
      message: 'Our team can help with that.',
    });

    renderWidget('/packages');
    const user = userEvent.setup();
    openPanel();
    await user.type(input(), 'can I talk to a person');
    await user.click(sendButton());

    const chip = await screen.findByRole('button', { name: 'Contact us' });
    await user.click(chip);

    expect(screen.getByTestId('location-probe').textContent).toBe('/contact');
  });

  it('clicking a nav chip navigates with the resolved path and fires a nav_click event', async () => {
    mockSendAssistantTurn.mockResolvedValue({
      toolCall: { tool: 'navigate', args: { route: 'packages' } },
      serverResult: { route: 'packages', path: '/packages' },
      message: 'I can take you to the packages page.',
    });
    renderWidget('/');
    const user = userEvent.setup();
    openPanel();

    await user.type(input(), 'Take me to packages');
    await user.click(sendButton());

    const chip = await screen.findByRole('button', { name: 'Go to Packages' });
    await user.click(chip);

    expect(screen.getByTestId('location-probe').textContent).toBe('/packages');
    expect(eventsOf('nav_click')).toHaveLength(1);
    expect(eventsOf('nav_click')[0][0]).toMatchObject({ eventType: 'nav_click', tool: 'navigate', route: 'packages' });
  });

  it('an answer_faq_policy no-match turn renders the server fallback message in the transcript', async () => {
    mockSendAssistantTurn.mockResolvedValue({
      toolCall: { tool: 'answer_faq_policy', args: { question: 'llama trekking' } },
      serverResult: { answered: false, fallbackMessage: "I don't have a confirmed answer to that — please contact support." },
      message: "I don't have a confirmed answer to that.",
    });
    renderWidget('/');
    const user = userEvent.setup();
    openPanel();

    await user.type(input(), 'Do you offer llama trekking?');
    await user.click(sendButton());

    expect(await screen.findByText("I don't have a confirmed answer to that — please contact support.")).toBeInTheDocument();
  });

  it('renders conversational and off-topic outcomes as plain assistant bubbles without action panels', async () => {
    mockSendAssistantTurn
      .mockResolvedValueOnce({
        toolCall: { tool: 'respond_conversationally', args: { mode: 'social', socialSubtype: 'greeting' } },
        serverResult: { mode: 'social', source: 'resolver' },
        message: 'Hi! I can help with your trip.',
      })
      .mockResolvedValueOnce({
        toolCall: { tool: 'redirect_off_topic', args: {} },
        serverResult: { redirected: true, source: 'resolver' },
        message: 'I can help with travel and LushWare trips.',
      });
    renderWidget('/');
    const user = userEvent.setup();
    openPanel();

    await user.type(input(), 'Hello');
    await user.click(sendButton());
    expect(await screen.findByText('Hi! I can help with your trip.')).toBeInTheDocument();

    await user.type(input(), 'Write a sorting algorithm');
    await user.click(sendButton());
    expect(await screen.findByText('I can help with travel and LushWare trips.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Go to / })).not.toBeInTheDocument();
    expect(screen.queryByText(/Policy source/)).not.toBeInTheDocument();
  });

  it('shows an accessible pending status only while a turn is in flight', async () => {
    let resolveTurn!: (value: {
      toolCall: { tool: 'respond_conversationally'; args: { mode: 'social'; socialSubtype: 'greeting' } };
      serverResult: { mode: 'social'; source: 'resolver' };
      message: string;
    }) => void;
    // Promise.withResolvers is unavailable under this client's configured lib.
    const pendingTurn = new Promise<Parameters<typeof resolveTurn>[0]>((resolve) => {
      resolveTurn = resolve;
    });
    mockSendAssistantTurn.mockReturnValue(pendingTurn);
    renderWidget('/');
    const user = userEvent.setup();
    openPanel();

    await user.type(input(), 'Hello');
    const pendingSend = user.click(sendButton());
    expect(await screen.findByRole('status')).toHaveTextContent('Thinking…');

    resolveTurn({
      toolCall: { tool: 'respond_conversationally', args: { mode: 'social', socialSubtype: 'greeting' } },
      serverResult: { mode: 'social', source: 'resolver' },
      message: 'Hi!',
    });
    await pendingSend;

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(await screen.findByText('Hi!')).toBeInTheDocument();
  });

  it('a failed turn renders the exact degraded-state banner and previous nav chips stay clickable', async () => {
    mockSendAssistantTurn
      .mockResolvedValueOnce({
        toolCall: { tool: 'navigate', args: { route: 'packages' } },
        serverResult: { route: 'packages', path: '/packages' },
        message: 'I can take you to the packages page.',
      })
      .mockRejectedValueOnce(new Error('network down'));
    renderWidget('/');
    const user = userEvent.setup();
    openPanel();

    await user.type(input(), 'Take me to packages');
    await user.click(sendButton());
    const chip = await screen.findByRole('button', { name: 'Go to Packages' });

    await user.type(input(), 'What about refunds?');
    await user.click(sendButton());
    expect(await screen.findByText('Failed to reach the assistant. Please try again.')).toBeInTheDocument();
    expect(eventsOf('error')).toHaveLength(1);

    // Degraded state never disables already-rendered chips — they are static
    // client-side links by then.
    await user.click(chip);
    expect(screen.getByTestId('location-probe').textContent).toBe('/packages');
    expect(eventsOf('nav_click')).toHaveLength(1);
  });

  it('blank or whitespace-only input never triggers a send', async () => {
    renderWidget('/');
    const user = userEvent.setup();
    openPanel();

    expect(sendButton()).toBeDisabled();

    await user.type(input(), '   ');
    expect(sendButton()).toBeDisabled();
    await user.keyboard('{Enter}');

    expect(mockSendAssistantTurn).not.toHaveBeenCalled();
    expect(eventsOf('turn')).toHaveLength(0);
  });

  it('closes the panel when the route becomes excluded, so it does not silently reopen on return', async () => {
    renderWidget('/packages');
    const user = userEvent.setup();
    openPanel();
    expect(dialog()).toBeInTheDocument();

    // The widget never unmounts (App.tsx mounts it unconditionally) — it
    // just renders null on an excluded route, so the store's open state
    // would otherwise survive the round trip and pop back open unprompted.
    // /my-account is the excluded route this exercises: /planner stopped being
    // one when the planner pages gained an action surface.
    await user.click(screen.getByRole('button', { name: 'go-to-/my-account' }));
    expect(screen.getByTestId('location-probe').textContent).toBe('/my-account');
    expect(dialog()).not.toBeInTheDocument();
    expect(getAssistantLauncherOpen()).toBe(false);

    await user.click(screen.getByRole('button', { name: 'go-to-/packages' }));
    expect(screen.getByTestId('location-probe').textContent).toBe('/packages');
    expect(dialog()).not.toBeInTheDocument();
    expect(getAssistantLauncherOpen()).toBe(false);
  });

  it('opens through the launcher: Contact options → Travel assistant', async () => {
    renderLauncherAndWidget('/');
    const user = userEvent.setup();

    expect(dialog()).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Contact options' }));
    await user.click(screen.getByRole('button', { name: 'Travel assistant' }));

    expect(dialog()).toBeInTheDocument();
    expect(eventsOf('opened')).toHaveLength(1);
  });
});
