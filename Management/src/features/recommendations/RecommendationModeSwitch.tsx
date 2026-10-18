import { Bot, ListChecks } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { RecommendationMode } from './recommendationMode';

export default function RecommendationModeSwitch({
  mode,
  onChange,
}: {
  mode: RecommendationMode;
  onChange: (mode: RecommendationMode) => void;
}) {
  const nextMode = mode === 'ai' ? 'rules' : 'ai';

  return (
    <Button variant="outline" size="sm" onClick={() => onChange(nextMode)}>
      {nextMode === 'rules' ? <ListChecks className="mr-1.5 h-4 w-4" /> : <Bot className="mr-1.5 h-4 w-4" />}
      Switch to {nextMode === 'rules' ? 'rule-based' : 'AI'}
    </Button>
  );
}