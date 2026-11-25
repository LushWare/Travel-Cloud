import prisma from '../db/client.js';
import AppError from '../utils/appError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { generateStructured } from '../ai/aiClient.js';
import { buildWizardTurnPrompt, wizardTurnResponseSchema } from '../ai/prompts/wizardTurn.v1.js';
import { sanitizeSlots } from './aiPackage.controller.js';
import { assembleWhere, buildInclude, serializePackage, serializePackageList } from '../services/package.service.js';
import { fetchPolicyDocuments, retrieveSnippets, FALLBACK_POLICY_MESSAGE } from '@travel-crm/policy-retrieval';
import { getOrgSettings } from '../config/orgSettings.js';
import { submitLeadIntake } from '../services/leadIntake.client.js';
import { LeadIntakeRequest } from '@travel-crm/contracts';

function latestUserMessage(messages) {
  for (let i = (messages || []).length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'user') return messages[i].content;
  }
  return '';
}

// ── Public: non-persisting UI-driven trip-planning wizard turn ──
// Implements docs/designs/ai-trip-planning-assistant.md's Approach C:
// the model picks exactly one tool call from a fixed vocabulary per turn;
// this handler executes the server-side work that tool implies and never
// trusts model-authored text for inventory, pricing, or policy quotes.
export const wizardTurn = asyncHandler(async (req, res) => {
  const { wizardState = {}, messages, sessionId } = req.body;

  // Policy retrieval is deterministic and cheap (no LLM cost) — always run
  // it against the latest message so a single generateStructured call can
  // both pick the tool AND, if it's answer_policy_question, choose among
  // already-retrieved candidates in the same turn (see wizardTurn.v1.js).
  const [documents, orgSettings] = await Promise.all([fetchPolicyDocuments(), getOrgSettings()]);
  const candidateSnippets = retrieveSnippets(documents, latestUserMessage(messages));

  const prompt = buildWizardTurnPrompt({ wizardState, messages, candidateSnippets });
  const { tool, args = {} } = await generateStructured({ prompt, schema: wizardTurnResponseSchema, maxOutputTokens: 1024 });

  let serverResult = null;
  let updatedWizardState = wizardState;
  let uiComponent;

  switch (tool) {
    case 'set_slot': {
      const mergedSlots = sanitizeSlots(args.slots, wizardState.slots);
      updatedWizardState = { ...wizardState, slots: mergedSlots };
      uiComponent = 'slotPrompt';
      break;
    }

    case 'propose_packages': {
      const criteria = args.criteria || {};
      const where = assembleWhere({
        isActive: true,
        minPrice: criteria.minPrice,
        maxPrice: criteria.maxPrice,
        search: criteria.destination || wizardState.slots?.destination || criteria.preferences,
      });
      // Reuses the exact buildInclude()/serializePackageList() pair
      // searchPackages already uses — no second, parallel serialization path.
      const packages = await prisma.package.findMany({
        where,
        include: buildInclude(),
        orderBy: { rating: 'desc' },
        take: 5,
      });
      serverResult = { packages: packages.map(serializePackageList) };
      uiComponent = 'packageCards';
      break;
    }

    case 'answer_policy_question': {
      const selectedIds = new Set(Array.isArray(args.selectedSnippetIds) ? args.selectedSnippetIds : []);
      // The model is never trusted with quote text — only with picking
      // which of the server-retrieved candidates (if any) apply. Zero
      // candidates, or a selection outside them, always degrades to the
      // fixed fallback; the model cannot override this (Premise 2).
      const chosen = candidateSnippets.filter((s) => selectedIds.has(s.id));
      if (candidateSnippets.length === 0 || chosen.length === 0) {
        serverResult = {
          answered: false,
          fallbackMessage: FALLBACK_POLICY_MESSAGE,
          supportEmail: orgSettings.supportEmail,
          whatsappNumber: orgSettings.whatsappNumber,
        };
      } else {
        serverResult = {
          answered: true,
          snippets: chosen.map((s) => ({ docId: s.docId, title: s.title, quote: s.quote })),
        };
      }
      uiComponent = 'policyAnswer';
      break;
    }

    case 'complete_wizard': {
      // The client sets wizardState.selectedPackageId deterministically when
      // the traveler clicks a proposed package — never parsed by the model
      // out of free text. Re-validated against the DB here regardless.
      const packageId = args.selectedPackageId || wizardState.selectedPackageId;
      const pkg = packageId ? await prisma.package.findUnique({ where: { id: packageId }, include: buildInclude() }) : null;
      if (!pkg || !pkg.isActive) {
        serverResult = { error: 'PACKAGE_NOT_FOUND' };
        uiComponent = 'error';
      } else {
        serverResult = { package: serializePackage(pkg) };
        uiComponent = 'complete';
      }
      break;
    }

    case 'capture_contact': {
      // Server-validated merge of the model's extracted contact fields into
      // wizardState.contact — only defined, non-empty string fields are kept
      // (same spirit as sanitizeSlots, but no numeric coercion: name/email/
      // phone/whatsapp are all strings). Whatever the traveler already gave
      // from a previous turn is preserved.
      const argsContact = args.contact || {};
      const currentContact = wizardState.contact || {};
      const mergedContact = { ...currentContact };
      for (const [field, value] of Object.entries(argsContact)) {
        if (typeof value === 'string' && value.length > 0) {
          mergedContact[field] = value;
        }
      }
      updatedWizardState = { ...wizardState, contact: mergedContact };
      uiComponent = 'contactPrompt';
      break;
    }

    default:
      throw new AppError('AI returned an unrecognized tool', 502);
  }

  // Durable-signal check: once the traveler has provided a real way to reach
  // them (email/phone/whatsapp) alongside meaningful trip intent (destination
  // plus either duration or a selected package), persist a PENDING_VERIFICATION
  // Lead in lead-service on EVERY turn where the condition holds — not just on
  // complete_wizard. Informational plumbing only: any intake failure is caught
  // here (the client never throws) and must never change what is returned to
  // the customer, so the result is deliberately not added to the response body.
  const contact = updatedWizardState.contact || {};
  const slots = updatedWizardState.slots || {};
  const hasContactMethod = Boolean(contact.email || contact.phone || contact.whatsapp);
  const hasDestination = Boolean(slots.destination);
  const hasTripIntent = Boolean(slots.duration || updatedWizardState.selectedPackageId);
  if (sessionId && hasContactMethod && hasDestination && hasTripIntent) {
    const payloadResult = LeadIntakeRequest.safeParse({
      channel: 'chatbot',
      sessionId,
      contact: {
        ...(contact.name ? { name: contact.name } : {}),
        ...(contact.email ? { email: contact.email } : {}),
        ...(contact.phone ? { phone: contact.phone } : {}),
        ...(contact.whatsapp ? { whatsapp: contact.whatsapp } : {}),
      },
      slots: {
        ...(slots.destination ? { destination: slots.destination } : {}),
        ...(slots.duration ? { duration: slots.duration } : {}),
        ...(slots.travelers ? { travelers: slots.travelers } : {}),
        ...(slots.budget ? { budget: slots.budget } : {}),
        ...(slots.preferences ? { preferences: slots.preferences } : {}),
      },
      transcript: (messages || []).map((m) => ({ id: m.id, role: m.role, content: m.content, at: m.at })),
      ...(updatedWizardState.selectedPackageId ? { selectedPackageId: updatedWizardState.selectedPackageId } : {}),
    });
    if (payloadResult.success) {
      // Deliberately awaited (not fire-and-forget), bounded by the client's
      // own 2s AbortController timeout — a considered eng-review tradeoff
      // (docs/designs/chatbot-inbound-lead-intake.md, Architecture finding
      // #3): awaiting bounds worst-case wizard-turn latency to a known
      // constant while keeping the failure log correlated to the exact turn
      // that triggered it. Pure fire-and-forget would remove all latency
      // cost here, but a timeout fires detached from the request lifecycle
      // and loses that correlation. Result is still discarded either way —
      // it never changes what's returned to the customer.
      try {
        await submitLeadIntake(payloadResult.data);
      } catch (err) {
        // Defense in depth — the client already logs and returns { ok: false },
        // so this should never fire; kept so an intake failure can never bubble
        // up and change the customer-facing turn.
      }
    }
  }

  res.json({
    success: true,
    data: { toolCall: { tool, args }, serverResult, updatedWizardState, uiComponent, message: args.message || '' },
  });
});
