import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '../contexts/AuthContext';
import { adminAPI } from '../services/api';
import { apiErrorMessage } from '@/lib/apiErrorMessage';

/** Lets the agency owner download every record the agency has, as spreadsheets in one ZIP. */
export default function DataExportSection() {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [savedAs, setSavedAs] = useState('');

  // Owners only, and never during Lushware's view-only support access. An owner is role superAdmin
  // (the same test the menu uses); the server checks again before building any export.
  const isOwner = user?.isSuperAdmin === true || user?.role === 'superAdmin';
  if (!isOwner || user?.helpAccess) return null;

  const download = async () => {
    setBusy(true);
    setError('');
    setSavedAs('');
    try {
      const blob: Blob = await adminAPI.exportAgencyData();
      const fileName = `agency-data-${new Date().toISOString().slice(0, 10)}.zip`;
      const url = URL.createObjectURL(new Blob([blob], { type: 'application/zip' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Revoking the link straight after click() cancels the download in some browsers; give it time to start.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setSavedAs(fileName);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="border-y border-border py-5" aria-labelledby="data-export-heading">
      <h2 id="data-export-heading" className="text-base font-semibold text-foreground">Export your data</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Download everything your agency has (leads, packages, quotations, invoices, bookings, staff and settings) as spreadsheets in one ZIP file. Passwords and connection secrets are never included.
      </p>
      {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
      {savedAs && (
        <p role="status" className="mt-2 text-sm text-foreground">
          Download started: <span className="font-medium">{savedAs}</span>. Look in your Downloads folder.
        </p>
      )}
      <Button type="button" variant="outline" className="mt-3 gap-2" onClick={download} disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
        {busy ? 'Preparing your export…' : 'Download all data'}
      </Button>
    </section>
  );
}
