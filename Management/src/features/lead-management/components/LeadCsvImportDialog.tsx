import { useState } from 'react';
import { FileUp, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { leadAPI } from '@/services/api';
import toast from '@/lib/toast';
import { apiErrorMessage } from '@/lib/apiErrorMessage';

type ImportRow = {
  rowNumber: number;
  data?: Record<string, unknown>;
  errors: string[];
};

type Preview = {
  totalRows: number;
  validCount: number;
  invalidCount: number;
  // Columns in the file that are not lead fields; their values are not imported.
  ignoredColumns?: string[];
  rows: ImportRow[];
};

interface LeadCsvImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

export default function LeadCsvImportDialog({ open, onOpenChange, onImported }: LeadCsvImportDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [importErrors, setImportErrors] = useState<ImportRow[]>([]);

  const reset = () => {
    setFile(null);
    setPreview(null);
    setImportErrors([]);
    setFileInputKey((key) => key + 1);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && !submitting) reset();
    onOpenChange(nextOpen);
  };

  const handlePreview = async () => {
    if (!file) return;
    setLoadingPreview(true);
    setImportErrors([]);
    try {
      const csv = await file.text();
      const response = await leadAPI.previewCsvImport(csv);
      setPreview(response.data);
    } catch (error) {
      toast.error(apiErrorMessage(error));
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleImport = async () => {
    if (!preview) return;
    const rows = preview.rows.filter((row) => row.data && row.errors.length === 0)
      .map(({ rowNumber, data }) => ({ rowNumber, data }));
    setSubmitting(true);
    try {
      const response = await leadAPI.importCsvRows(rows);
      const result = response.data;
      setImportErrors(result.errors || []);
      toast.success(`${result.importedCount} lead${result.importedCount === 1 ? '' : 's'} imported`);
      onImported();
      if (!result.errors?.length) {
        reset();
        onOpenChange(false);
      } else setPreview((current) => current ? {
        ...current,
        validCount: 0,
        invalidCount: current.totalRows,
      } : current);
    } catch (error) {
      toast.error(apiErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const visibleErrors = importErrors.length ? importErrors : preview?.rows.filter((row) => row.errors.length) || [];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import leads from CSV</DialogTitle>
          <DialogDescription>
            Upload a CSV up to 1 MB and 500 rows. We read name, email, phone, whatsapp, city, destination, travel date, number of travellers, budget and message (common spellings such as "Full Name" or "phone_number" work too). Other columns are skipped.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              key={fileInputKey}
              type="file"
              accept=".csv,text/csv"
              aria-label="CSV file"
              onChange={(event) => {
                setFile(event.target.files?.[0] || null);
                setPreview(null);
                setImportErrors([]);
              }}
            />
            <Button type="button" variant="outline" disabled={!file || loadingPreview || submitting} onClick={handlePreview}>
              {loadingPreview ? <Loader2 className="animate-spin" /> : <FileUp />}
              Preview
            </Button>
          </div>

          {preview && (
            <section aria-live="polite" className="space-y-3 rounded-lg border border-border p-4">
              <p className="text-sm font-medium">
                {preview.validCount} ready to import · {preview.invalidCount} need attention · {preview.totalRows} total
              </p>
              {preview.ignoredColumns && preview.ignoredColumns.length > 0 && (
                <p className="text-xs text-muted-foreground" data-testid="csv-ignored-columns">
                  Not imported ({preview.ignoredColumns.length} column{preview.ignoredColumns.length === 1 ? '' : 's'} we don't use): {preview.ignoredColumns.join(', ')}
                </p>
              )}
              {visibleErrors.length > 0 && (
                <div className="max-h-56 overflow-auto rounded-md border border-border">
                  <table className="w-full text-left text-sm">
                    <thead className="sticky top-0 bg-muted">
                      <tr><th className="p-2">Row</th><th className="p-2">Issue</th></tr>
                    </thead>
                    <tbody>
                      {visibleErrors.map((row) => (
                        <tr key={row.rowNumber} className="border-t border-border align-top">
                          <td className="p-2">{row.rowNumber}</td>
                          <td className="p-2">{row.errors.join(' ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="flex justify-end">
                <Button type="button" disabled={!preview.validCount || submitting} onClick={handleImport}>
                  {submitting && <Loader2 className="animate-spin" />}
                  Import {preview.validCount} leads
                </Button>
              </div>
            </section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
