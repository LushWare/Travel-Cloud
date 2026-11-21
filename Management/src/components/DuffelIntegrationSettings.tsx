import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Loader2, Plane, PlugZap, Trash2 } from 'lucide-react';
import toast from '@/lib/toast';
import { integrationAPI } from '../services/api';
import { apiErrorMessage } from '@/lib/apiErrorMessage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type DuffelStatus = {
  connected: boolean;
  status?: string;
  mode?: 'test' | 'live' | null;
  lastFour?: string | null;
  bookingUpdates?: 'on' | 'off';
  bookingUpdatesNote?: string | null;
  lastTestedAt?: string | null;
  lastError?: string | null;
};

const TOKEN_PATTERN = '^duffel_(test|live)_[A-Za-z0-9_\\-]{10,256}$';

/** Settings > Integrations: the agency's own Duffel account, used for every flight search and booking. */
export default function DuffelIntegrationSettings() {
  const [status, setStatus] = useState<DuffelStatus | null>(null);
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const loadStatus = useCallback(async () => {
    const response = await integrationAPI.getDuffel();
    setStatus(response.data as DuffelStatus);
  }, []);

  useEffect(() => {
    loadStatus()
      .catch((error) => toast.error(apiErrorMessage(error)))
      .finally(() => setLoading(false));
  }, [loadStatus]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await integrationAPI.saveDuffel({ accessToken: token.trim() });
      setStatus(response.data as DuffelStatus);
      setToken('');
      toast.success('Duffel account connected');
    } catch (error) {
      toast.error(apiErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      await integrationAPI.testDuffel();
      toast.success('Duffel connection is working');
    } catch (error) {
      toast.error(apiErrorMessage(error));
    } finally {
      await loadStatus().catch(() => {});
      setTesting(false);
    }
  };

  const disconnect = async () => {
    setDisconnecting(true);
    try {
      const response = await integrationAPI.disconnectDuffel();
      setStatus(response.data as DuffelStatus);
      toast.success('Duffel disconnected');
    } catch (error) {
      toast.error(apiErrorMessage(error));
    } finally {
      setDisconnecting(false);
    }
  };

  const connected = status?.connected === true;

  return (
    <section className="rounded-xl border border-border bg-card" aria-labelledby="agency-duffel-heading">
      <div className="border-b border-border p-5">
        <div className="flex items-start gap-3">
          <Plane className="mt-0.5 h-5 w-5 text-primary" aria-hidden="true" />
          <div>
            <h2 id="agency-duffel-heading" className="font-semibold text-foreground">Flights (Duffel)</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Search and book flights with your agency&apos;s own Duffel account. Tickets are paid from your Duffel balance.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-5 p-5">
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading Duffel connection" />
        ) : (
          <>
            <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground" data-testid="duffel-status">
              {connected
                ? `Connected: ${status?.mode === 'live' ? 'live' : 'test'} account, token ending ${status?.lastFour}. The token is encrypted and never shown here.`
                : status?.status === 'error'
                  ? 'Duffel stopped accepting the saved token. Paste a new one to resume flight search and booking.'
                  : 'Not connected. Flight search and booking stay off until you connect your Duffel account.'}
            </div>

            {connected && (
              <p className="text-sm" data-testid="duffel-booking-updates">
                <span className="font-medium">Automatic booking updates: {status?.bookingUpdates === 'on' ? 'On' : 'Off'}</span>
                {status?.bookingUpdates !== 'on' && status?.bookingUpdatesNote && (
                  <span className="text-muted-foreground"> · {status.bookingUpdatesNote}</span>
                )}
              </p>
            )}

            {connected && status?.mode === 'test' && (
              <p className="text-sm text-muted-foreground">
                This is a test token: bookings are not real tickets. Paste a live token when you are ready to sell.
              </p>
            )}

            <form onSubmit={save} className="space-y-3">
              <div className="space-y-1.5 text-sm">
                <label htmlFor="duffel-access-token" className="block font-medium">
                  {connected ? 'Replace access token' : 'Duffel access token'}
                </label>
                <Input
                  id="duffel-access-token"
                  required
                  type="password"
                  autoComplete="off"
                  pattern={TOKEN_PATTERN}
                  title="Starts with duffel_test_ or duffel_live_"
                  aria-describedby="duffel-access-token-help"
                  value={token}
                  // Trimmed as typed: a token pasted with a stray space would otherwise fail the format check.
                  onChange={(e) => setToken(e.target.value.trim())}
                  placeholder="duffel_live_…"
                />
                <p id="duffel-access-token-help" className="text-xs text-muted-foreground">
                  In your Duffel dashboard: Developers → Access tokens → Create token. Paste it here.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={saving || !token.trim()} className="gap-2">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
                  {saving ? 'Checking and saving…' : connected ? 'Replace token' : 'Test and connect'}
                </Button>
                {(connected || status?.status === 'error') && (
                  <>
                    <Button type="button" variant="outline" onClick={test} disabled={testing || saving}>
                      {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Test saved connection
                    </Button>
                    <Button type="button" variant="outline" onClick={disconnect} disabled={disconnecting || saving} className="text-destructive">
                      {disconnecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                      Disconnect
                    </Button>
                  </>
                )}
              </div>
            </form>

            {status?.lastTestedAt && (
              <p className="text-xs text-muted-foreground">
                Last checked {new Date(status.lastTestedAt).toLocaleString()}
                {status.lastError ? ` · ${status.lastError}` : ''}
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
