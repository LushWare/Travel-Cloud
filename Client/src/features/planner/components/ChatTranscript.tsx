import { Bot, Loader2, User } from 'lucide-react';
import useLenisScrollContainment from '../../../lib/useLenisScrollContainment';

export interface ChatTranscriptMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatTranscriptProps {
  greeting: string;
  messages: ChatTranscriptMessage[];
  isSending: boolean;
}

/**
 * Shared chat-bubble rendering for the itinerary chat panel (Phase 1) and the
 * trip-planning wizard panel (Phase 2) — both are simple role-tagged message
 * lists with the same bubble styling, so the transcript markup lives here
 * once rather than being copy-pasted into each panel.
 */
export default function ChatTranscript({ greeting, messages, isSending }: ChatTranscriptProps) {
  const { scrollRef, handleWheelCapture } = useLenisScrollContainment();

  return (
    <div
      ref={scrollRef}
      onWheelCapture={handleWheelCapture}
      className="max-h-80 overflow-y-auto p-4 space-y-3 bg-gray-50"
    >
      <div className="flex items-start gap-2">
        <Bot className="w-5 h-5 text-brand-600 mt-0.5 shrink-0" />
        <p className="text-sm bg-white rounded-xl px-3 py-2 shadow-sm">{greeting}</p>
      </div>
      {messages.map((m, i) => (
        <div key={i} className={`flex items-start gap-2 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
          {m.role === 'user' ? (
            <User className="w-5 h-5 text-gray-500 mt-0.5 shrink-0" />
          ) : (
            <Bot className="w-5 h-5 text-brand-600 mt-0.5 shrink-0" />
          )}
          <p className={`text-sm rounded-xl px-3 py-2 shadow-sm ${m.role === 'user' ? 'bg-brand-600 text-white' : 'bg-white'}`}>
            {m.content}
          </p>
        </div>
      ))}
      {isSending && <Loader2 className="w-4 h-4 animate-spin text-brand-600" />}
    </div>
  );
}
