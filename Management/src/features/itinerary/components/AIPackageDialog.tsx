/**
 * AI Package Generation Dialog
 * Allows users to input basic details and generate a complete package using AI
 */

import { useState } from 'react';
import { Sparkles, Loader2, MapPin, FileText, Briefcase, Tag, Moon, Wand2 } from 'lucide-react';
import ApiService from '../services/apiService';
import DestinationSelector from './DestinationSelector';
import Swal from 'sweetalert2';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface AIPackageDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onPackageGenerated: (pkg: any) => void;
}

const packageTypes = [
  { value: 'Standard', label: 'Standard', icon: '⚡' },
  { value: 'Deluxe', label: 'Deluxe', icon: '✨' },
  { value: 'Luxury', label: 'Luxury', icon: '💎' },
  { value: 'Premium', label: 'Premium', icon: '👑' },
];

const categories = [
  { value: 'honeymoon', label: 'Honeymoon', icon: '💑' },
  { value: 'family', label: 'Family', icon: '👨‍👩‍👧‍👦' },
  { value: 'adventure', label: 'Adventure', icon: '🏔️' },
  { value: 'budget', label: 'Budget', icon: '💰' },
  { value: 'luxury', label: 'Luxury', icon: '✨' },
  { value: 'religious', label: 'Religious', icon: '🛕' },
  { value: 'wildlife', label: 'Wildlife', icon: '🦁' },
  { value: 'beach', label: 'Beach', icon: '🏖️' },
  { value: 'heritage', label: 'Heritage', icon: '🏛️' },
  { value: 'other', label: 'Other', icon: '📦' },
];

const DEFAULT_FORM = {
  destination: '',
  description: '',
  packageType: 'Standard',
  category: 'family',
  nights: 1,
};

// Input Card Component
const InputCard = ({ label, required, icon: Icon, children, hint }: {
  label: string; required?: boolean; icon?: any; children: React.ReactNode; hint?: string;
}) => (
  <div className="bg-card rounded-lg border border-border p-4 hover:border-ring/30 transition-colors">
    <label className="flex items-center gap-2 text-sm font-medium text-foreground mb-3">
      {Icon && <Icon className="w-4 h-4 text-muted-foreground" />}
      {label}
      {required && <span className="text-destructive text-xs">*</span>}
    </label>
    {children}
    {hint && <p className="text-xs text-muted-foreground mt-2">{hint}</p>}
  </div>
);

const AIPackageDialog = ({ isOpen, onClose, onPackageGenerated }: AIPackageDialogProps) => {
  const [formData, setFormData] = useState(DEFAULT_FORM);
  const [isGenerating, setIsGenerating] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: name === 'nights' ? Math.max(1, parseInt(value, 10) || 1) : value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.destination.trim()) {
      Swal.fire('Validation Error', 'Please enter a destination', 'error');
      return;
    }

    if (formData.nights < 1) {
      Swal.fire('Validation Error', 'Number of nights must be at least 1', 'error');
      return;
    }

    setIsGenerating(true);

    try {
      const response = await ApiService.generateAIPackage(
        formData.destination,
        formData.packageType,
        formData.category,
        formData.nights,
        formData.description
      );

      if (response.success && response.data) {
        onPackageGenerated(response.data);

        Swal.fire({
          icon: 'success',
          title: 'Package Generated!',
          text: 'AI has generated your package. You can now review and edit it before saving.',
          confirmButtonText: 'Continue Editing',
        });

        setFormData(DEFAULT_FORM);
        onClose();
      } else {
        throw new Error(response.message || 'Failed to generate package');
      }
    } catch (error) {
      console.error('Error generating AI package:', error);
      Swal.fire({
        icon: 'error',
        title: 'Generation Failed',
        text: (error as Error).message || 'Failed to generate package. Please try again.',
        confirmButtonText: 'OK',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleClose = () => {
    if (!isGenerating) {
      setFormData(DEFAULT_FORM);
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold">AI Package Generator</DialogTitle>
              <DialogDescription>Create complete packages with AI</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            {/* Destination */}
            <InputCard label="Destination" required icon={MapPin}>
              <div className={isGenerating ? 'pointer-events-none opacity-60' : ''}>
                <DestinationSelector
                  value={formData.destination}
                  onChange={handleChange as any}
                  name="destination"
                />
              </div>
            </InputCard>

            {/* Two Column Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Package Type */}
              <InputCard label="Package Type" icon={Briefcase}>
                <Select
                  value={formData.packageType}
                  onValueChange={(value) => setFormData((prev) => ({ ...prev, packageType: String(value) }))}
                  disabled={isGenerating}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>{(v: string) => {
                      const type = packageTypes.find((t) => t.value === v);
                      return type ? `${type.icon} ${type.label}` : v;
                    }}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {packageTypes.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.icon} {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </InputCard>

              {/* Category */}
              <InputCard label="Category" icon={Tag}>
                <Select
                  value={formData.category}
                  onValueChange={(value) => setFormData((prev) => ({ ...prev, category: String(value) }))}
                  disabled={isGenerating}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>{(v: string) => {
                      const cat = categories.find((c) => c.value === v);
                      return cat ? `${cat.icon} ${cat.label}` : v;
                    }}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((cat) => (
                      <SelectItem key={cat.value} value={cat.value}>
                        {cat.icon} {cat.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </InputCard>
            </div>

            {/* Number of Nights */}
            <InputCard label="Number of Nights" required icon={Moon}>
              <div className="flex items-center gap-4">
                <Input
                  type="number"
                  name="nights"
                  value={formData.nights}
                  onChange={handleChange}
                  min="1"
                  required
                  disabled={isGenerating}
                  className="flex-1 text-center text-lg font-medium"
                />
                <div className="px-4 py-2 bg-primary/10 rounded-lg border border-primary/20">
                  <span className="text-sm font-medium text-primary">{formData.nights + 1} Days / {formData.nights} Nights</span>
                </div>
              </div>
            </InputCard>

            {/* Package Details (Optional) */}
            <InputCard label="Special Requirements" icon={FileText} hint="Add any specific requests or preferences">
              <Textarea
                name="description"
                value={formData.description}
                onChange={handleChange}
                placeholder="e.g., Include water sports, prefer beachside hotels, need vegetarian food options..."
                disabled={isGenerating}
                rows={3}
              />
            </InputCard>
          </div>

          {/* Info Box */}
          <div className="mt-6 p-5 bg-primary/5 rounded-lg border border-primary/10">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
                <Wand2 className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="font-semibold text-primary text-sm mb-1">What AI will generate:</p>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-primary rounded-full" />
                    Complete day-by-day itinerary with activities
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-primary rounded-full" />
                    Hotel recommendations and accommodations
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-primary rounded-full" />
                    Highlights, inclusions, and exclusions
                  </li>
                </ul>
                <p className="text-xs text-muted-foreground mt-2 italic">
                  Package will be saved as draft for your review before publishing
                </p>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 mt-6">
            <Button
              type="button"
              onClick={handleClose}
              disabled={isGenerating}
              variant="outline"
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isGenerating}
              className="flex-1"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Generate Package
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default AIPackageDialog;
