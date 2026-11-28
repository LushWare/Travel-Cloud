import { useMemo } from 'react';
import { Download, ExternalLink, FileText, MapPin, Calendar, Banknote, Users, X } from 'lucide-react';
import { formatPriceINR } from '../utils/helpers';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { usePdfPreview, PdfViewerFrame, PDF_DIALOG_SIZE_CLASSES } from '@/components/shared/PdfPreview';

const FALLBACK_FILE_NAME = 'travel-itinerary.pdf';

interface PackagePDFPreviewDialogProps {
  isOpen: boolean;
  onClose: () => void;
  pdfBlob?: Blob | null;
  fileName?: string;
  onDownload?: () => void;
  packageData?: any;
  isGenerating?: boolean;
}

const PackagePDFPreviewDialog = ({
  isOpen,
  onClose,
  pdfBlob,
  fileName = FALLBACK_FILE_NAME,
  onDownload,
  packageData,
  isGenerating = false,
}: PackagePDFPreviewDialogProps) => {
  const { blobUrl: previewUrl, loading, error } = usePdfPreview({ isOpen, pdfBlob });

  const summaryItems = useMemo(() => {
    if (!packageData) return [];

    return [
      {
        label: 'Destination',
        value: packageData.destination || 'Not specified',
        icon: MapPin,
      },
      {
        label: 'Duration',
        value: packageData.duration ? `${packageData.duration} days` : 'Not specified',
        icon: Calendar,
      },
      {
        // Same price as the package card and website: per person, twin sharing.
        label: 'Price per person (twin sharing)',
        value: formatPriceINR(packageData.sellPrice ?? packageData.price) || 'On request',
        icon: Banknote,
      },
      {
        label: 'Group Size',
        value: packageData.maxGroupSize ? `${packageData.maxGroupSize} guests` : 'Flexible',
        icon: Users,
      },
    ].filter((item) => !!item.value);
  }, [packageData]);

  const handleDownload = () => {
    if (onDownload) {
      onDownload();
      return;
    }

    if (!pdfBlob) return;

    const link = document.createElement('a');
    link.href = previewUrl || URL.createObjectURL(pdfBlob);
    link.download = fileName || FALLBACK_FILE_NAME;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    if (!previewUrl) {
      URL.revokeObjectURL(link.href);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        showCloseButton={false}
        className={`p-0 gap-0 flex flex-col overflow-hidden ${PDF_DIALOG_SIZE_CLASSES}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border bg-primary px-3 sm:px-6 py-3 sm:py-4 rounded-t-none sm:rounded-t-xl">
          <div className="flex items-center gap-2 sm:gap-3 text-primary-foreground min-w-0">
            <div className="flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-lg bg-primary-foreground/20 shrink-0">
              <FileText className="h-5 w-5 sm:h-6 sm:w-6" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg sm:text-2xl font-heading font-semibold">Itinerary Preview</h2>
              <p className="text-xs sm:text-sm text-primary-foreground/80 truncate">
                {packageData?.name || 'Travel package'} · {fileName}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {previewUrl && !isGenerating && (
              <Button
                variant="ghost"
                size="sm"
                className="text-primary-foreground hover:bg-primary-foreground/20 hover:text-primary-foreground"
                title="Open in new tab"
                render={<a href={previewUrl} target="_blank" rel="noopener noreferrer" />}
              >
                <ExternalLink className="h-4 w-4" />
                <span className="hidden sm:inline">Open in Tab</span>
              </Button>
            )}
            <Button
              onClick={handleDownload}
              disabled={!pdfBlob || isGenerating}
              variant="secondary"
              size="sm"
            >
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">Download PDF</span>
            </Button>
            <button
              onClick={onClose}
              className="rounded-full p-2 text-primary-foreground transition hover:bg-primary-foreground/20"
              aria-label="Close preview"
            >
              <X className="h-6 w-6" />
            </button>
          </div>
        </div>

        <div className="flex flex-1 flex-col lg:flex-row min-h-0">
          {/* Preview Area */}
          <div className="relative flex-1 bg-muted">
            {isGenerating ? (
              <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
                <div className="flex h-16 w-16 animate-spin items-center justify-center rounded-full border-4 border-primary border-t-transparent"></div>
                <p className="text-lg font-medium text-foreground">Crafting your premium itinerary...</p>
                <p className="text-sm text-muted-foreground">
                  This usually takes just a few seconds. We're styling the document for you.
                </p>
              </div>
            ) : (
              <PdfViewerFrame
                blobUrl={previewUrl}
                loading={loading}
                error={error}
                title="Package PDF Preview"
                emptyMessage="We couldn't render the PDF preview. Try downloading the itinerary instead."
              />
            )}
          </div>

          {/* Summary Sidebar */}
          <aside className="w-full border-t border-border bg-card p-6 text-sm text-muted-foreground overflow-y-auto lg:w-80 lg:border-l lg:border-t-0">
            <h3 className="flex items-center gap-2 text-lg font-heading font-semibold text-foreground">
              <FileText className="h-5 w-5 text-primary" />
              Package Snapshot
            </h3>
            <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Auto-filled from your package details
            </p>

            <div className="mt-4 space-y-3">
              {summaryItems.map(({ label, value, icon: Icon }) => (
                <div
                  key={label}
                  className="flex items-start gap-3 rounded-lg border border-border bg-muted px-3 py-3"
                >
                  <div className="mt-0.5 rounded-lg bg-card p-2 shadow-card">
                    <Icon className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
                    <p className="text-sm font-semibold text-foreground">{value}</p>
                  </div>
                </div>
              ))}

              {packageData?.highlights?.length ? (
                <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
                  <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary">
                    Signature Highlights
                  </p>
                  <ul className="mt-2 space-y-1 text-sm text-foreground">
                    {packageData.highlights.slice(0, 4).map((highlight: string, index: number) => (
                      <li key={index} className="flex items-start gap-2">
                        <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary" />
                        <span>{highlight}</span>
                      </li>
                    ))}
                    {packageData.highlights.length > 4 && (
                      <li className="mt-1 text-xs italic text-primary">
                        +{packageData.highlights.length - 4} more curated experiences
                      </li>
                    )}
                  </ul>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-primary/30 px-4 py-3 text-xs text-primary">
                  Add highlights to your package to showcase unique experiences on the cover page.
                </div>
              )}
            </div>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PackagePDFPreviewDialog;
