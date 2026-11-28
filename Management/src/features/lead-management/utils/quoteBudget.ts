export interface QuoteTotal {
  amount: number;
  currency: string;
}

export interface ParsedBudget {
  amount: number;
  currency: string | null;
}

export function parseBudget(budget: unknown): ParsedBudget | null {
  if (budget === null || budget === undefined) return null;
  const text = String(budget).trim();
  if (!text) return null;
  const match = text.replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*(k)?/i);
  if (!match) return null;
  const amount = Number(match[1]) * (match[2] ? 1000 : 1);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const code = text.match(/\b([A-Z]{3})\b/);
  return { amount, currency: code ? code[1] : null };
}

export function formatMoney(amount: number, currency?: string | null): string {
  const value = amount.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return currency ? `${currency} ${value}` : value;
}

export interface BudgetCheck {
  quote: QuoteTotal | null;
  budget: ParsedBudget | null;
  /** True only when both are known, in the same currency, and the quote is higher. */
  overBudget: boolean;
  /** How much the quote exceeds the budget (0 when within it or unknown). */
  overBy: number;
}

/**
 * Compares the quote with the customer's budget. Only compares when the
 * currencies agree (a budget with no currency is assumed to be in the quote's).
 */
export function checkQuoteAgainstBudget(lead: { budget?: unknown; quoteTotal?: QuoteTotal | null } | null | undefined): BudgetCheck {
  const quote = lead?.quoteTotal && Number(lead.quoteTotal.amount) > 0 ? lead.quoteTotal : null;
  const budget = parseBudget(lead?.budget);
  const comparable = Boolean(quote && budget && (!budget.currency || budget.currency === quote.currency));
  const overBy = comparable ? Math.max(0, Math.round((quote!.amount - budget!.amount) * 100) / 100) : 0;
  return { quote, budget, overBudget: overBy > 0, overBy };
}
