import { useEffect, useState } from 'react';
import { X, Download, Loader2, ArrowLeft, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

import { API_BASE_URL, authFetch } from '@/lib/authFetch';

// Large enough to feel like a real document viewer instead of a cramped
// modal, capped so it doesn't stretch unreasonably wide on ultra-wide
// monitors. Full-bleed on mobile, matching the prior per-caller convention.
//
// The sm: variants are deliberate: DialogContent's base carries `sm:max-w-sm`,
// and twMerge only drops that constraint when the caller's override shares
// its `sm:` variant — a bare `max-w-[1600px]` survives the merge and loses
// the CSS cascade to the later-emitted `sm:max-w-sm`, silently shrinking the
// dialog to 384px on desktop.
export const PDF_DIALOG_SIZE_CLASSES = 'w-full sm:w-[95vw] max-w-[1920px] sm:max-w-[1920px] h-full sm:h-[90vh] rounded-none sm:rounded-xl';

interface UsePdfPreviewArgs {
  isOpen: boolean;
  pdfUrl?: string | null;
  pdfBlob?: Blob | null;
}

interface UsePdfPreviewResult {
  blobUrl: string | null;
  loading: boolean;
  error: boolean;
}

/**
 * Single source of truth for turning either a fetchable PDF URL or an
 * already-fetched Blob into a displayable object URL, with loading/error
 * state and object-URL cleanup handled once instead of per call site.
 */
export function usePdfPreview({ isOpen, pdfUrl, pdfBlob }: UsePdfPreviewArgs): UsePdfPreviewResult {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!isOpen) return undefined;

    setError(false);

    if (pdfBlob) {
      const url = URL.createObjectURL(pdfBlob);
      setBlobUrl(url);
      return () => URL.revokeObjectURL(url);
    }

    if (pdfUrl) {
      setLoading(true);
      setBlobUrl(null);

      const fullUrl = pdfUrl.startsWith('http') ? pdfUrl : `${API_BASE_URL}${pdfUrl}`;

      let cancelled = false;
      let url: string | null = null;

      authFetch(fullUrl)
        .then((response) => {
          if (!response.ok) throw new Error(`Failed to load PDF (HTTP ${response.status})`);
          return response.blob();
        })
        .then((blob) => {
          if (cancelled) return;
          url = URL.createObjectURL(blob);
          setBlobUrl(url);
          setLoading(false);
        })
        .catch((err) => {
          console.error('Error loading PDF:', err);
          if (!cancelled) {
            setLoading(false);
            setError(true);
          }
        });

      return () => {
        cancelled = true;
        if (url) URL.revokeObjectURL(url);
      };
    }

    setBlobUrl(null);
    return undefined;
  }, [isOpen, pdfUrl, pdfBlob]);

  return { blobUrl, loading, error };
}

interface PdfViewerFrameProps {
  blobUrl: string | null;
  loading?: boolean;
  error?: boolean;
  emptyMessage?: string;
  title?: string;
}

/** The one PDF-rendering surface every preview dialog composes. */
export function PdfViewerFrame({ blobUrl, loading, error, emptyMessage, title = 'PDF Preview' }: PdfViewerFrameProps) {
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <span className="ml-2 text-muted-foreground">Loading PDF...</span>
      </div>
    );
  }

  if (blobUrl) {
    return <iframe src={blobUrl} className="h-full w-full" style={{ border: 'none' }} title={title} />;
  }

  return (
    <div className="flex h-full items-center justify-center text-muted-foreground">
      <p>{error ? 'Failed to load PDF' : emptyMessage || 'No preview available'}</p>
    </div>
  );
}

interface PdfPreviewDialogProps {
  isOpen: boolean;
  onClose: () => void;
  pdfUrl?: string | null;
  pdfBlob?: Blob | null;
  documentName?: string;
  fileName?: string;
  onDownload?: boolean | (() => void);
  onBack?: () => void;
  documents?: unknown[];
  currentIndex?: number;
  onNavigate?: (index: number) => void;
}

/** Full modal PDF preview — header (nav/download/open-in-tab/close) + PdfViewerFrame. */
export function PdfPreviewDialog({
  isOpen,
  onClose,
  pdfUrl,
  pdfBlob,
  documentName,
  fileName,
  onDownload,
  onBack,
  documents = [],
  currentIndex = 0,
  onNavigate,
}: PdfPreviewDialogProps) {
  const { blobUrl, loading, error } = usePdfPreview({ isOpen, pdfUrl, pdfBlob });

  const handleDownload = () => {
    if (typeof onDownload === 'function') {
      onDownload();
      return;
    }
    if (!blobUrl) return;
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = `${fileName || documentName || 'document'}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleBack = () => {
    if (onBack) onBack();
    else onClose();
  };

  const canNavigate = documents.length > 1;
  const canGoPrevious = currentIndex > 0;
  const canGoNext = currentIndex < documents.length - 1;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent showCloseButton={false} className={`p-0 gap-0 flex flex-col ${PDF_DIALOG_SIZE_CLASSES}`}>
        <div className="px-3 sm:px-6 py-3 sm:py-4 border-b border-border flex items-center justify-between bg-primary rounded-t-none sm:rounded-t-xl">
          <div className="flex items-center gap-2 sm:gap-4 min-w-0">
            {onBack && (
              <Button variant="ghost" size="sm" onClick={handleBack} className="text-primary-foreground hover:bg-primary-foreground/20 hover:text-primary-foreground" title="Back to Form">
                <ArrowLeft className="w-4 h-4" />
                <span className="hidden sm:inline">Back</span>
              </Button>
            )}
            <div className="min-w-0">
              <h2 className="text-lg sm:text-2xl font-bold text-primary-foreground">PDF Preview</h2>
              <p className="text-primary-foreground/80 text-sm mt-1">
                {documentName || 'Document'}
                {canNavigate && (
                  <span className="ml-2 opacity-75">
                    ({currentIndex + 1} of {documents.length})
                  </span>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 sm:gap-3 shrink-0">
            {canNavigate && (
              <div className="flex items-center gap-1 sm:gap-2 mr-1 sm:mr-2">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => canGoPrevious && onNavigate?.(currentIndex - 1)}
                  disabled={!canGoPrevious}
                  className="text-primary-foreground hover:bg-primary-foreground/20 hover:text-primary-foreground disabled:opacity-50"
                  title="Previous Document"
                >
                  <ChevronLeft className="w-5 h-5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => canGoNext && onNavigate?.(currentIndex + 1)}
                  disabled={!canGoNext}
                  className="text-primary-foreground hover:bg-primary-foreground/20 hover:text-primary-foreground disabled:opacity-50"
                  title="Next Document"
                >
                  <ChevronRight className="w-5 h-5" />
                </Button>
              </div>
            )}
            {blobUrl && !loading && (
              <Button
                variant="ghost"
                size="sm"
                className="text-primary-foreground hover:bg-primary-foreground/20 hover:text-primary-foreground"
                title="Open in new tab"
                render={<a href={blobUrl} target="_blank" rel="noopener noreferrer" />}
              >
                <ExternalLink className="w-4 h-4" />
                <span className="hidden sm:inline">Open in Tab</span>
              </Button>
            )}
            {onDownload && blobUrl && !loading && (
              <Button variant="secondary" size="sm" onClick={handleDownload}>
                <Download className="w-4 h-4" />
                <span className="hidden sm:inline">Download</span>
              </Button>
            )}
            <button onClick={onClose} className="text-primary-foreground hover:opacity-80 transition-colors" title="Close">
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden relative">
          <PdfViewerFrame blobUrl={blobUrl} loading={loading} error={error} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default PdfPreviewDialog;
