import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AiLeadBadges, { isAiHandled, needsRepCheck, isAiVerified } from '../AiLeadBadges';

const aiLead = (over = {}) => ({ aiHandled: true, needsRepFollowup: false, aiVerifiedAt: null, ...over });

describe('AiLeadBadges rendering', () => {
  it('renders nothing for a lead the voice agent never touched', () => {
    const { container } = render(<AiLeadBadges lead={{ aiHandled: false }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for a null lead', () => {
    const { container } = render(<AiLeadBadges lead={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the AI badge for an AI-handled lead', () => {
    render(<AiLeadBadges lead={aiLead()} />);
    expect(screen.getByText('AI')).toBeInTheDocument();
  });

  it('shows the needs-check badge when the agent left something unresolved', () => {
    render(<AiLeadBadges lead={aiLead({ needsRepFollowup: true })} />);
    expect(screen.getByText('Needs Rep Attention')).toBeInTheDocument();
    expect(screen.getByLabelText('The voice agent could not resolve something, or made changes awaiting approval'))
      .toHaveClass('bg-amber-100', 'text-amber-800');
  });

  it('shows a red rep-review badge for a package or price change', () => {
    render(<AiLeadBadges lead={aiLead({ voiceNeedsRepReview: true, voiceReviewReason: 'package_changed_requires_repricing' })} />);
    expect(screen.getByText('Rep review')).toBeInTheDocument();
    expect(screen.getByLabelText('Package or price changed; review before proceeding'))
      .toHaveClass('bg-amber-100', 'text-amber-800');
    expect(screen.queryByText('Needs Rep Attention')).not.toBeInTheDocument();
  });

  it('shows the verified badge once a rep has reviewed the lead', () => {
    render(<AiLeadBadges lead={aiLead({ aiVerifiedAt: '2026-09-10T10:00:00.000Z' })} />);
    expect(screen.getByText('Verified')).toBeInTheDocument();
  });

  it('hides the verified badge while the lead still needs a rep check', () => {
    render(<AiLeadBadges lead={aiLead({ needsRepFollowup: true, aiVerifiedAt: '2026-09-10T10:00:00.000Z' })} />);
    expect(screen.queryByText('Verified')).not.toBeInTheDocument();
  });

  it('hides text labels in compact mode but keeps the accessible name', () => {
    render(<AiLeadBadges lead={aiLead()} compact />);
    expect(screen.queryByText('AI')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Created or updated by the voice agent')).toBeInTheDocument();
  });
});

describe('AiLeadBadges predicates', () => {
  it('reports a lead created by the voice agent as AI handled', () => {
    expect(isAiHandled(aiLead())).toBe(true);
  });

  it('reports a manually created lead as not AI handled', () => {
    expect(isAiHandled({ aiHandled: false })).toBe(false);
  });

  it('reports false for an undefined lead rather than throwing', () => {
    expect(isAiHandled(undefined)).toBe(false);
  });

  it('reports a flagged lead as needing a rep check', () => {
    expect(needsRepCheck(aiLead({ needsRepFollowup: true }))).toBe(true);
  });

  it('reports a package-change lead as needing a rep check', () => {
    expect(needsRepCheck(aiLead({ voiceNeedsRepReview: true }))).toBe(true);
  });

  it('treats a verified timestamp on an AI lead as verified', () => {
    expect(isAiVerified(aiLead({ aiVerifiedAt: '2026-09-10T10:00:00.000Z' }))).toBe(true);
  });

  it('does not treat a verified timestamp on a non-AI lead as AI verified', () => {
    expect(isAiVerified({ aiHandled: false, aiVerifiedAt: '2026-09-10T10:00:00.000Z' })).toBe(false);
  });

  it('treats an AI lead with no verification timestamp as unverified', () => {
    expect(isAiVerified(aiLead())).toBe(false);
  });
});
