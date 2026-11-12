import AppError from '../utils/appError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { idParamSchema, formatZodError } from '../validators/common.js';
import { createPolicyDocumentSchema, updatePolicyDocumentSchema } from '../validators/policyDocument.validator.js';
import {
  listPolicyDocuments,
  getPolicyDocumentById,
  createPolicyDocument,
  updatePolicyDocument,
  deletePolicyDocument,
} from '../services/policyDocuments.service.js';
import { audit } from '../utils/audit.js';

// Policies are what the AI assistant quotes to customers, so every change is recorded.
const auditPolicy = (req, action, doc, verb) => audit(req, {
  action, targetType: 'policy_document', targetId: doc.id, summary: `${verb} policy "${doc.title}"`.slice(0, 300),
});

function parseOrThrow(schema, value) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AppError(formatZodError(parsed.error), 400);
  return parsed.data;
}

export const getPolicyDocuments = asyncHandler(async (req, res) => {
  const documents = await listPolicyDocuments();
  res.json({ status: 'success', data: { documents } });
});

export const getPolicyDocument = asyncHandler(async (req, res) => {
  const { id } = parseOrThrow(idParamSchema, req.params);
  const document = await getPolicyDocumentById(id);
  if (!document) throw new AppError('Policy document not found', 404);
  res.json({ status: 'success', data: { document } });
});

export const postPolicyDocument = asyncHandler(async (req, res) => {
  const data = parseOrThrow(createPolicyDocumentSchema, req.body);
  const document = await createPolicyDocument(data, req.user.id);
  await auditPolicy(req, 'policy.created', document, 'Created');
  res.status(201).json({ status: 'success', message: 'Policy document created', data: { document } });
});

export const putPolicyDocument = asyncHandler(async (req, res) => {
  const { id } = parseOrThrow(idParamSchema, req.params);
  const data = parseOrThrow(updatePolicyDocumentSchema, req.body);
  const existing = await getPolicyDocumentById(id);
  if (!existing) throw new AppError('Policy document not found', 404);
  const document = await updatePolicyDocument(id, data, req.user.id);
  await auditPolicy(req, 'policy.updated', document, 'Updated');
  res.json({ status: 'success', message: 'Policy document updated', data: { document } });
});

export const deletePolicyDocumentHandler = asyncHandler(async (req, res) => {
  const { id } = parseOrThrow(idParamSchema, req.params);
  const existing = await getPolicyDocumentById(id);
  if (!existing) throw new AppError('Policy document not found', 404);
  await deletePolicyDocument(id);
  await auditPolicy(req, 'policy.deleted', existing, 'Deleted');
  res.json({ status: 'success', data: {} });
});

// Token-authenticated (see admin.routes.js) — mirrors getInternalOrganizationSettings.
// Consumed by package-service's trip-planning wizard for server-side keyword
// retrieval; never reached through the gateway.
export const getInternalPolicyDocuments = asyncHandler(async (req, res) => {
  const documents = await listPolicyDocuments();
  res.json({ status: 'success', data: { documents } });
});
