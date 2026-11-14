import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, PlugZap, Trash2 } from 'lucide-react';
import toast from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { integrationAPI } from '../services/api';

type WhatsappStatus = {
  connected: boolean;
  status: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  lastTestedAt: string | null;
  lastError: string | null;
  appId: string | null;
  configurationId: string | null;
  graphApiVersion: string;
};

type WhatsappSignupAssets = { wabaId: string; phoneNumberId: string };
type FacebookSdkFailureReason = 'download' | 'timeout' | 'initialization';

class FacebookSdkLoadError extends Error {
  constructor(readonly reason: FacebookSdkFailureReason) {
    super(`Meta SDK ${reason} failed`);
    this.name = 'FacebookSdkLoadError';
  }
}

type FacebookSdk = {
  init: (options: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }) => void;
  login: (
    callback: (response: { authResponse?: { code?: string } }) => void,
    options: { config_id: string; response_type: 'code'; override_default_response_type: boolean; extras: { setup: Record<string, never> } },
  ) => void;
};

declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}

let facebookSdkPromise: Promise<void> | null = null;
const META_MESSAGE_HOSTS = new Set(['facebook.com', 'www.facebook.com', 'web.facebook.com', 'm.facebook.com']);
const FACEBOOK_SDK_LOAD_TIMEOUT_MS = 15_000;

function loadFacebookSdk(appId: string, version: string) {
  if (window.FB) {
    try {
      window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version });
      return Promise.resolve();
    } catch {
      return Promise.reject(new FacebookSdkLoadError('initialization'));
    }
  }
  if (!facebookSdkPromise) {
    facebookSdkPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.async = true;
      script.defer = true;
      script.id = 'facebook-jssdk';
      script.src = 'https://connect.facebook.net/en_US/sdk.js';
      let settled = false;
      const fail = (reason: FacebookSdkFailureReason) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        script.remove();
        window.fbAsyncInit = undefined;
        facebookSdkPromise = null;
        reject(new FacebookSdkLoadError(reason));
      };
      const initialize = () => {
        if (!window.FB) {
          fail('initialization');
          return;
        }
        try {
          window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version });
          settled = true;
          window.clearTimeout(timeoutId);
          resolve();
        } catch {
          fail('initialization');
        }
      };
      const timeoutId = window.setTimeout(() => fail('timeout'), FACEBOOK_SDK_LOAD_TIMEOUT_MS);
      window.fbAsyncInit = initialize;
      script.onerror = () => fail('download');
      document.head.appendChild(script);
    });
  }
  return facebookSdkPromise;
}

function launchSignup(configurationId: string): Promise<{ code: string } & WhatsappSignupAssets> {
  return new Promise((resolve, reject) => {
    let code: string | null = null;
    let assets: WhatsappSignupAssets | null = null;
    const timeout = window.setTimeout(() => finish(new Error('WhatsApp setup timed out. Try again.')), 120_000);

    const cleanup = () => {
      window.clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
    };
    const finish = (error?: Error) => {
      if (error) {
        cleanup();
        reject(error);
      } else if (code && assets) {
        cleanup();
        resolve({ code, ...assets });
      }
    };
    const onMessage = (event: MessageEvent) => {
      let host: string;
      try {
        host = new URL(event.origin).hostname;
      } catch {
        return;
      }
      if (!META_MESSAGE_HOSTS.has(host)) return;
      let payload: { type?: string; event?: string; data?: Record<string, unknown> };
      try {
        payload = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      } catch {
        return;
      }
      if (payload?.type !== 'WA_EMBEDDED_SIGNUP') return;
      if (payload.event === 'CANCEL' || payload.event === 'ERROR') {
        finish(new Error('WhatsApp setup was not completed.'));
        return;
      }
      const wabaId = payload.data?.waba_id;
      const phoneNumberId = payload.data?.phone_number_id;
      if (typeof wabaId === 'string' && typeof phoneNumberId === 'string') {
        assets = { wabaId, phoneNumberId };
        finish();
      }
    };

    window.addEventListener('message', onMessage);
    try {
      if (!window.FB) throw new Error('Meta login could not be initialized');
      window.FB.login((response) => {
        const receivedCode = response.authResponse?.code;
        if (!receivedCode) {
          finish(new Error('Meta did not return an authorization code. Try connecting again.'));
          return;
        }
        code = receivedCode;
        finish();
      }, {
        config_id: configurationId,
        response_type: 'code',
        override_default_response_type: true,
        extras: { setup: {} },
      });
    } catch (error) {
      finish(error instanceof Error ? error : new Error('Could not start WhatsApp setup.'));
    }
  });
}

export default function WhatsAppIntegrationSettings() {
  const [status, setStatus] = useState<WhatsappStatus | null>(null);
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(true);
  const [sdkReady, setSdkReady] = useState(false);
  const [sdkError, setSdkError] = useState<FacebookSdkFailureReason | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const loadStatus = async () => {
    const response = await integrationAPI.getWhatsapp();
    setStatus(response.data as WhatsappStatus);
  };

  useEffect(() => {
    loadStatus()
      .catch((error) => toast.error(error?.message || 'Could not load WhatsApp setup'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!status?.appId || !status.configurationId) return;
    let active = true;
    loadFacebookSdk(status.appId, status.graphApiVersion)
      .then(() => {
        if (active) {
          setSdkReady(true);
          setSdkError(null);
        }
      })
      .catch((error) => {
        if (active) {
          setSdkReady(false);
          setSdkError(error instanceof FacebookSdkLoadError ? error.reason : 'initialization');
        }
      });
    return () => { active = false; };
  }, [status?.appId, status?.configurationId, status?.graphApiVersion]);

  const retryMeta = async () => {
    if (!status?.appId) return;
    setSdkError(null);
    try {
      await loadFacebookSdk(status.appId, status.graphApiVersion);
      setSdkReady(true);
    } catch (error) {
      setSdkError(error instanceof FacebookSdkLoadError ? error.reason : 'initialization');
    }
  };

  const connect = async () => {
    if (!status?.appId || !status.configurationId) {
      toast.error('WhatsApp setup is not configured by Lushware yet');
      return;
    }
    setConnecting(true);
    try {
      if (!window.FB) throw new Error('Meta login is still loading. Try again in a moment.');
      const signup = await launchSignup(status.configurationId);
      const response = await integrationAPI.connectWhatsapp({ ...signup, pin });
      setStatus(response.data as WhatsappStatus);
      setPin('');
      toast.success('WhatsApp Business connected');
    } catch (error) {
      toast.error((error as Error)?.message || 'Could not connect WhatsApp');
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm('Disconnect WhatsApp Business? Messages will stop using this number.')) return;
    setDisconnecting(true);
    try {
      const response = await integrationAPI.disconnectWhatsapp();
      setStatus(response.data as WhatsappStatus);
      toast.success('WhatsApp Business disconnected');
    } catch (error) {
      toast.error((error as Error)?.message || 'Could not disconnect WhatsApp');
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <section className="rounded-xl border border-border bg-card" aria-labelledby="whatsapp-integration-heading">
      <div className="border-b border-border p-5">
        <div className="flex items-start gap-3">
          <PlugZap className="mt-0.5 h-5 w-5 text-primary" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h2 id="whatsapp-integration-heading" className="font-semibold text-foreground">WhatsApp Business</h2>
            <p className="mt-1 text-sm text-muted-foreground">Connect the agency&apos;s Meta business phone number.</p>
          </div>
          {status?.connected && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              Connected
            </span>
          )}
        </div>
      </div>
      <div className="space-y-4 p-5">
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading WhatsApp setup" />
        ) : (
          <>
            <p className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
              {status?.connected
                ? `${status.verifiedName || 'WhatsApp Business'}${status.displayPhoneNumber ? ` · ${status.displayPhoneNumber}` : ''}`
                : 'Connect an agency-owned WhatsApp number. Meta will ask the business admin to authorize access.'}
            </p>
            {!status?.connected && status?.appId && status.configurationId && window.location.protocol !== 'https:' && (
              <p className="text-sm text-muted-foreground">
                This page is using {window.location.protocol}. Meta Embedded Signup requires an HTTPS address; use the production site or an HTTPS development tunnel.
              </p>
            )}
            {status?.connected && (
              <p className="text-sm text-muted-foreground">
                Add a payment method in{' '}
                <a className="underline underline-offset-2" href="https://business.facebook.com/wa/manage/home/" target="_blank" rel="noreferrer">
                  WhatsApp Manager
                </a>{' '}
                before sending messages.
              </p>
            )}
            {!status?.connected && (
              <div className="max-w-xs space-y-1.5">
                <label htmlFor="whatsapp-registration-pin" className="text-sm font-medium">Meta two-step verification PIN</label>
                <input
                  id="whatsapp-registration-pin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={6}
                  pattern="[0-9]{6}"
                  value={pin}
                  onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  aria-describedby="whatsapp-pin-help"
                  disabled={connecting}
                />
                <p id="whatsapp-pin-help" className="text-xs text-muted-foreground">Choose a six-digit PIN for Meta phone registration.</p>
              </div>
            )}
            {!status?.appId || !status.configurationId ? (
              <p role="status" className="text-sm text-muted-foreground">
                WhatsApp setup is not configured by Lushware yet. An administrator must add the Meta App ID and WhatsApp Signup Configuration ID.
              </p>
            ) : null}
            {sdkError && (
              <p role="alert" className="text-sm text-destructive">
                {sdkError === 'download'
                  ? "The browser couldn't download Meta's signup SDK from connect.facebook.net. Check network access or browser privacy blockers, then retry."
                  : sdkError === 'timeout'
                    ? "Meta's signup SDK did not respond in time. Check network access or browser privacy blockers, then retry."
                    : "Meta's signup SDK downloaded but failed to initialize. Check the Meta App ID and Graph API version configured for this service."}
              </p>
            )}
            {status?.lastError && <p role="alert" className="text-sm text-destructive">{status.lastError}</p>}
            <div className="flex flex-wrap gap-2">
              {!status?.connected ? (
                <Button
                  type="button"
                  onClick={sdkError ? retryMeta : connect}
                  disabled={
                    connecting ||
                    !status?.appId ||
                    !status.configurationId ||
                    (!sdkError && (!sdkReady || pin.length !== 6))
                  }
                  className="gap-2"
                >
                  {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
                  {connecting ? 'Connecting…' : !status?.appId || !status.configurationId ? 'Setup required' : sdkError ? 'Retry Meta' : sdkReady ? 'Connect WhatsApp' : 'Loading Meta…'}
                </Button>
              ) : (
                <Button type="button" variant="outline" onClick={disconnect} disabled={disconnecting} className="gap-2 text-destructive">
                  {disconnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  Disconnect
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}