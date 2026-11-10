import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Loader2 } from 'lucide-react';
import toast from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { API_BASE_URL, authFetch } from '@/lib/authFetch';
import { clearPendingTenantChoice, peekPendingTenantChoice } from '@/lib/pendingTenantChoice';
import { useAuth } from '../contexts/AuthContext';

interface AgencyOption {
  id: string;
  name: string;
  slug: string;
  role: string;
}

const ROLE_LABELS: Record<string, string> = {
  superAdmin: 'Owner',
  admin: 'Admin',
  salesRep: 'Sales rep',
  vendor: 'Vendor',
};

export default function ChooseAgency() {
  const navigate = useNavigate();
  const { setAuth } = useAuth();
  const [pending] = useState(() => peekPendingTenantChoice());
  const [choosing, setChoosing] = useState<string | null>(null);

  useEffect(() => {
    if (!pending) navigate('/login', { replace: true });
  }, [pending, navigate]);

  if (!pending) return null;

  const choose = async (agency: AgencyOption) => {
    setChoosing(agency.id);
    try {
      const response = await authFetch(`${API_BASE_URL}/auth/select-tenant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectionToken: pending.selectionToken, tenantId: agency.id }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error(body?.message || 'Could not open that agency. Please sign in again.');
        clearPendingTenantChoice();
        navigate('/login', { replace: true });
        return;
      }
      clearPendingTenantChoice();
      setAuth(body.data.user);
      navigate('/', { replace: true });
    } catch {
      toast.error('Could not reach the server. Please try again.');
    } finally {
      setChoosing(null);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <h1 className="font-heading text-2xl font-bold text-foreground mb-1">Choose an agency</h1>
          <p className="text-muted-foreground text-sm">You belong to more than one agency. Pick the one to work in now.</p>
        </div>
        <ul className="space-y-3">
          {(pending.tenants as AgencyOption[]).map((agency) => (
            <li key={agency.id}>
              <Button
                variant="outline"
                className="w-full h-auto justify-start gap-3 p-4 text-left"
                disabled={choosing !== null}
                onClick={() => choose(agency)}
              >
                {choosing === agency.id ? <Loader2 className="animate-spin" size={20} /> : <Building2 size={20} />}
                <span className="flex flex-col">
                  <span className="font-medium text-foreground">{agency.name}</span>
                  <span className="text-xs text-muted-foreground">{ROLE_LABELS[agency.role] || agency.role}</span>
                </span>
              </Button>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-center text-xs text-muted-foreground">To change agency later, log out and log in again.</p>
      </div>
    </div>
  );
}
