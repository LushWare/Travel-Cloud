/**
 * Basic Package Info Form Component
 * Handles package title, description, category, destination, inclusions, and exclusions
 */

import { useState, useEffect, useRef } from 'react';
import { Sparkles, MapPin, Tag, FileText, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import toast from '@/lib/toast';
import { CATEGORY_OPTIONS } from '../../utils/constants';
import DestinationSelector from '../DestinationSelector';
import packageAIApi from '../../../../services/packageAIApi';
import { API_BASE_URL, authFetch } from '@/lib/authFetch';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface BasicPackageInfoProps {
  formData: any;
  onChange: (data: any) => void;
  packageId?: string | null;
}

// Input Card Component
const InputCard = ({ label, required, icon: Icon, children, hint, className = '' }: {
  label: string; required?: boolean; icon?: any; children: React.ReactNode; hint?: string; className?: string;
}) => (
  <div className={`bg-card rounded-lg border border-border p-4 hover:border-ring/30 transition-colors ${className}`}>
    <label className="flex items-center gap-2 text-sm font-medium text-foreground mb-3">
      {Icon && <Icon className="w-4 h-4 text-muted-foreground" />}
      {label}
      {required && <span className="text-destructive text-xs">*</span>}
    </label>
    {children}
    {hint && <p className="text-xs text-muted-foreground mt-2">{hint}</p>}
  </div>
);

const BasicPackageInfo = ({ formData, onChange }: BasicPackageInfoProps) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [autoGenerateEnabled, setAutoGenerateEnabled] = useState(false);
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Check AI status on mount
  useEffect(() => {
    const checkAIStatus = async () => {
      try {
        const response = await authFetch(`${API_BASE_URL}/packages/ai-status`);

        if (!response.ok) {
          if (response.status === 401 || response.status === 403) { setAiConfigured(null); return; }
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        setAiConfigured(data.configured === true && data.keyFormat === 'valid');
      } catch (error) {
        console.error('Error checking AI status:', error);
        setAiConfigured(null);
      }
    };
    checkAIStatus();
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    onChange({ ...formData, [name]: value });
  };

  const handleArrayFieldChange = (name: string, value: string) => {
    onChange({ ...formData, [name]: value });
  };

  const handleArrayFieldBlur = (name: string, value: string) => {
    const arrayValue = value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    onChange({ ...formData, [name]: arrayValue });
  };

  const getArrayFieldValue = (fieldName: string) => {
    const value = formData[fieldName];
    if (Array.isArray(value)) {
      return value.join(', ');
    }
    return value || '';
  };

  const generateAIContent = async (title: string) => {
    if (!title || title.trim() === '') {
      return;
    }

    setIsGenerating(true);
    try {
      const response = await packageAIApi.generateFromTitle({
        title: title.trim(),
        destination: formData.destination || null,
        duration: formData.durationDays || null,
        category: formData.category || null,
      });

      if (response.success && response.data) {
        const aiContent = response.data;

        onChange({
          ...formData,
          description: aiContent.description || formData.description,
          inclusions: aiContent.inclusions || formData.inclusions,
          exclusions: aiContent.exclusions || formData.exclusions,
        });

        if (!autoGenerateEnabled) {
          toast.success('AI content generated and applied successfully!');
        }
      } else {
        if (!autoGenerateEnabled) {
          toast.error(response.message || 'Failed to generate AI content');
        }
      }
    } catch (error: any) {
      console.error('Error generating AI content:', error);
      console.error('Error details:', {
        status: error.status,
        statusCode: error.statusCode,
        message: error.message,
        data: error.data,
        isNetworkError: error.isNetworkError,
      });

      if (error.isNetworkError || error.status === 0 || error.message.includes('Cannot connect to server') || error.message.includes('ERR_CONNECTION_REFUSED')) {
        toast.error('Cannot connect to server. Please make sure the server is running on port 5000.');
        return;
      }

      if (error.status === 401 || error.statusCode === 401) {
        const errorMessage = error.data?.message || error.message || 'Your session has expired';
        toast.error(`${errorMessage}. Please login again.`);
        return;
      }

      if (error.status === 503 || error.statusCode === 503) {
        const errorMessage = error.data?.error || error.data?.message || error.message;
        if (errorMessage.includes('model not found') || errorMessage.includes('not available')) {
          toast.error('AI models not available. Your API key doesn\'t have access to Gemini models. Please check the API key configuration.', {
            duration: 6000,
          });
          setAiConfigured(false);
        } else {
          toast.error(errorMessage || 'AI service is currently unavailable.');
        }
        return;
      }

      if (!autoGenerateEnabled) {
        const errorMessage = error.data?.error || error.data?.message || error.message || 'Failed to generate AI content. Please check your API key.';
        toast.error(errorMessage, { duration: 5000 });
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAIGenerate = async () => {
    if (!formData.title || formData.title.trim() === '') {
      toast.error('Please enter a package name first');
      return;
    }

    setAutoGenerateEnabled(false);
    await generateAIContent(formData.title);
  };

  return (
    <div className="space-y-4">
      {/* Two Column Grid for Destination and Name */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Destination */}
        <InputCard label="Destination" required icon={MapPin} hint="Select from popular destinations or type a custom one">
          <DestinationSelector
            name="destination"
            value={formData.destination || ''}
            onChange={handleChange as any}
          />
        </InputCard>

        {/* Category */}
        <InputCard label="Category" required icon={Tag}>
          <Select value={formData.category || undefined} onValueChange={(value) => onChange({ ...formData, category: String(value) })}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select Category">
                {(value: string) => CATEGORY_OPTIONS.find((o) => o.value === value)?.label ?? value}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {CATEGORY_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </InputCard>
      </div>

      {/* Package Name with AI Button */}
      <InputCard label="Package Name" required icon={FileText}>
        <div className="flex items-stretch gap-3">
          <Input
            type="text"
            name="title"
            value={formData.title || ''}
            onChange={handleChange}
            placeholder="e.g., 7-Day Sri Lanka Adventure"
            className="flex-1"
          />
          {formData.title && formData.title.trim().length >= 3 && (
            <Button
              type="button"
              onClick={handleAIGenerate}
              disabled={isGenerating || aiConfigured === false}
              variant="outline"
              title={
                aiConfigured === false
                  ? "AI not configured. Add GEMINI_API_KEY to Services/package-service/.env and restart the service."
                  : "Generate description, highlights, inclusions, and exclusions using AI"
              }
            >
              <Sparkles className={`w-4 h-4 ${isGenerating ? 'animate-spin' : ''}`} />
              {isGenerating ? 'Generating...' : 'AI Generate'}
            </Button>
          )}
        </div>

        {/* AI Status Messages */}
        {formData.title && formData.title.trim().length >= 3 && (
          <>
            {aiConfigured === false && (
              <div className="mt-4 bg-destructive/5 rounded-lg border border-destructive/20 p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
                  <div className="space-y-2">
                    <p className="font-semibold text-destructive text-sm">AI Generation Not Available</p>
                    <p className="text-muted-foreground text-xs">
                      Your API key doesn't have access to Gemini models. All models return 404 (not found).
                    </p>
                    <div className="pt-2 border-t border-destructive/20 mt-2 space-y-1">
                      <p className="text-xs text-muted-foreground">
                        <strong>Quick Fix:</strong> Get a NEW API key from{' '}
                        <a
                          href="https://makersuite.google.com/app/apikey"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary underline font-medium"
                        >
                          AI Studio (makersuite.google.com)
                        </a>
                      </p>
                      <p className="text-xs text-muted-foreground italic">
                        💡 You can still create packages manually — AI generation is optional.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {aiConfigured === true && (
              <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-primary" />
                Click "AI Generate" to auto-fill description, highlights, inclusions, and exclusions
              </p>
            )}
          </>
        )}
      </InputCard>

      {/* Description */}
      <InputCard label="Description" required icon={FileText}>
        <Textarea
          name="description"
          placeholder="Describe your travel package..."
          value={formData.description || ''}
          onChange={handleChange}
          rows={4}
        />
      </InputCard>

      {/* Two Column Grid for Lists */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Inclusions */}
        <InputCard label="Inclusions" icon={CheckCircle} hint="What's included (comma separated)" className="lg:col-span-1">
          <Textarea
            name="inclusions"
            placeholder="Hotel accommodation, All meals, Tour guide..."
            value={getArrayFieldValue('inclusions')}
            onChange={(e) => handleArrayFieldChange('inclusions', e.target.value)}
            onBlur={(e) => handleArrayFieldBlur('inclusions', e.target.value)}
            rows={4}
          />
        </InputCard>

        {/* Exclusions */}
        <InputCard label="Exclusions" icon={XCircle} hint="What's not included (comma separated)" className="lg:col-span-1">
          <Textarea
            name="exclusions"
            placeholder="Flight tickets, Personal expenses, Travel insurance..."
            value={getArrayFieldValue('exclusions')}
            onChange={(e) => handleArrayFieldChange('exclusions', e.target.value)}
            onBlur={(e) => handleArrayFieldBlur('exclusions', e.target.value)}
            rows={4}
          />
        </InputCard>
      </div>
    </div>
  );
};

export default BasicPackageInfo;
