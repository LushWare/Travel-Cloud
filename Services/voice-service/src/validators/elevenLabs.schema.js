import { z } from 'zod';

const phone = z.string().min(1).max(50);

export const initiationSchema = z.object({
  caller_id: phone.nullable().optional(),
  called_number: phone,
  agent_id: z.string().max(255),
  conversation_id: z.string().min(1).max(255),
  call_sid: z.string().max(255).optional(),
});

const transcriptTurn = z.object({
  role: z.enum(['agent', 'user']),
  message: z.string().max(5000).nullable().optional(),
  time_in_call_secs: z.number().nonnegative().optional(),
});

const dataCollectionResult = z.object({
  value: z.unknown().optional(),
  rationale: z.string().max(5000).optional(),
}).passthrough();

export const postCallSchema = z.object({
  type: z.enum(['post_call_transcription', 'post_call_audio', 'call_initiation_failure']),
  event_timestamp: z.number().nonnegative().optional(),
  data: z.object({
    conversation_id: z.string().min(1).max(255),
    agent_id: z.string().max(255).optional(),
    status: z.string().max(64).optional(),
    transcript: z.array(transcriptTurn).max(2000).optional(),
    metadata: z.object({
      start_time_unix_secs: z.number().nonnegative().optional(),
      call_duration_secs: z.number().nonnegative().optional(),
      cost_fiat: z.number().nonnegative().nullable().optional(),
      has_audio: z.boolean().optional(),
      phone_call: z.object({
        direction: z.enum(['inbound', 'outbound']).optional(),
        external_number: phone.optional(),
        agent_number: phone.optional(),
      }).passthrough().optional(),
    }).passthrough().optional(),
    analysis: z.object({
      transcript_summary: z.string().max(5000).optional(),
      data_collection_results: z.record(dataCollectionResult).optional(),
    }).passthrough().optional(),
    has_audio: z.boolean().optional(),
  }).passthrough(),
}).passthrough();