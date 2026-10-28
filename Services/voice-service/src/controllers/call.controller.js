import prisma from '../db/client.js';
import AppError from '../utils/appError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { Readable } from 'node:stream';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Every call on a lead, newest first, never merged. Powers the AI tab.
export const listCallsForLead = asyncHandler(async (req, res) => {
  const { leadId } = req.params;
  if (!UUID_RE.test(leadId)) throw new AppError('Invalid lead id', 400);

  const calls = await prisma.voiceCall.findMany({
    where: { leadId, disposition: { not: 'IN_PROGRESS' } },
    orderBy: { startedAt: 'desc' },
    take: 100,
    include: { events: { orderBy: { sequence: 'asc' } } },
  });

  res.json({
    success: true,
    data: calls.map((c) => ({
      id: c.id,
      startedAt: c.startedAt,
      endedAt: c.endedAt,
      durationSec: c.durationSec,
      direction: c.direction,
      disposition: c.disposition,
      matchOutcome: c.matchOutcome,
      needsRepFollowup: c.needsRepFollowup,
      summary: c.summary,
      sentiment: c.sentiment,
      transcript: c.transcript ?? [],
      hasRecording: Boolean(c.recordingUrl),
      actions: c.events.map((e) => ({
        sequence: e.sequence,
        functionName: e.functionName,
        succeeded: e.succeeded,
        createdAt: e.createdAt,
      })),
    })),
  });
});

export const streamCallRecording = asyncHandler(async (req, res) => {
  if (!UUID_RE.test(req.params.callId)) throw new AppError('Invalid call id', 400);
  const call = await prisma.voiceCall.findUnique({
    where: { id: req.params.callId },
    select: { conversationId: true, recordingUrl: true },
  });
  if (!call?.recordingUrl) throw new AppError('Recording not found', 404);

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    req.log?.error('ELEVENLABS_API_KEY is not configured — recording playback unavailable');
    throw new AppError('Recording playback unavailable', 503);
  }

  const response = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversations/${encodeURIComponent(call.conversationId)}/audio`,
    { headers: { 'xi-api-key': apiKey } },
  );
  if (!response.ok || !response.body) {
    req.log?.error({ status: response.status }, 'ElevenLabs recording request failed');
    throw new AppError('Recording unavailable', 502);
  }

  res.status(200);
  res.set('content-type', response.headers.get('content-type') || 'audio/mpeg');
  res.set('cache-control', 'private, no-store');
  Readable.fromWeb(response.body).pipe(res);
});

