ALTER TABLE "crm_voice"."VoiceNumber" RENAME COLUMN "retellAgentId" TO "agentId";
ALTER TABLE "crm_voice"."VoiceCall" RENAME COLUMN "retellCallId" TO "conversationId";

ALTER INDEX "crm_voice"."VoiceCall_retellCallId_key" RENAME TO "VoiceCall_conversationId_key";