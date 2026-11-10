import { Edit, Trash, Mail, Key } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { STATUS_COLORS } from '../../utils/constants';
import { formatDate } from '../../utils/helpers';

export interface SalesRep {
  id: string;
  name: string;
  email: string;
  phone?: string;
  status: string;
  accountStatus?: string;
  commissionRate: number;
  permissions: string[];
  leadsAssigned: number;
  leadsConverted: number;
  createdAt?: string;
  lastLogin?: string | null;
  isActive?: boolean;
  isEmailVerified?: boolean;
  isTempPassword?: boolean;
  mustChangePassword?: boolean;
  phoneCountry?: string;
}

export interface SalesRepTableProps {
  reps: SalesRep[];
  onlineStatus?: Record<string, boolean>;
  onEdit: (rep: SalesRep) => void;
  onDelete: (rep: SalesRep) => void;
  onResendInvite?: (rep: SalesRep) => void;
  onForcePasswordReset?: (rep: SalesRep) => void;
}

const SalesRepTable = ({
  reps,
  onlineStatus = {},
  onEdit,
  onDelete,
  onResendInvite,
  onForcePasswordReset,
}: SalesRepTableProps) => {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-card">
      <table className="min-w-full divide-y divide-border">
        <thead className="bg-muted/50">
          <tr>
            <th className="border-r border-border px-4 py-3 text-left text-xs font-bold tracking-wider text-muted-foreground uppercase">Online</th>
            <th className="border-r border-border px-4 py-3 text-left text-xs font-bold tracking-wider text-muted-foreground uppercase">Name</th>
            <th className="border-r border-border px-4 py-3 text-left text-xs font-bold tracking-wider text-muted-foreground uppercase">Email</th>
            <th className="border-r border-border px-4 py-3 text-left text-xs font-bold tracking-wider text-muted-foreground uppercase">Phone</th>
            <th className="border-r border-border px-4 py-3 text-left text-xs font-bold tracking-wider text-muted-foreground uppercase">Leads Assigned</th>
            <th className="border-r border-border px-4 py-3 text-left text-xs font-bold tracking-wider text-muted-foreground uppercase">Converted</th>
            <th className="border-r border-border px-4 py-3 text-left text-xs font-bold tracking-wider text-muted-foreground uppercase">Conv. Rate</th>
            <th className="border-r border-border px-4 py-3 text-left text-xs font-bold tracking-wider text-muted-foreground uppercase">Commission</th>
            <th className="border-r border-border px-4 py-3 text-left text-xs font-bold tracking-wider text-muted-foreground uppercase">Status</th>
            <th className="border-r border-border px-4 py-3 text-left text-xs font-bold tracking-wider text-muted-foreground uppercase">Last Login</th>
            <th className="px-4 py-3 text-left text-xs font-bold tracking-wider text-muted-foreground uppercase">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {reps.map((rep) => {
            const conversionRate =
              rep.leadsAssigned > 0 ? ((rep.leadsConverted / rep.leadsAssigned) * 100).toFixed(1) : '0';
            const isOnline = onlineStatus[rep.id] === true;

            return (
              <tr key={rep.id} className="transition-colors hover:bg-muted/50">
                <td className="border-r border-border px-4 py-3 text-sm">
                  <div className="flex items-center justify-center">
                    <span
                      className={`size-3 rounded-full ${isOnline ? 'bg-success' : 'bg-muted-foreground/30'}`}
                      title={isOnline ? 'Online' : 'Offline'}
                    />
                  </div>
                </td>
                <td className="border-r border-border px-4 py-3 text-sm font-semibold text-foreground">{rep.name}</td>
                <td className="border-r border-border px-4 py-3 text-sm text-muted-foreground">{rep.email}</td>
                <td className="border-r border-border px-4 py-3 text-sm text-muted-foreground">{rep.phone}</td>
                <td className="border-r border-border px-4 py-3 text-sm">
                  <Badge variant="secondary">{rep.leadsAssigned}</Badge>
                </td>
                <td className="border-r border-border px-4 py-3 text-sm">
                  <Badge variant="secondary" className="bg-success/10 text-success">
                    {rep.leadsConverted}
                  </Badge>
                </td>
                <td className="border-r border-border px-4 py-3 text-sm">
                  <Badge
                    variant="secondary"
                    className={
                      Number(conversionRate) >= 30
                        ? 'bg-success/10 text-success'
                        : Number(conversionRate) >= 15
                          ? 'bg-warning/10 text-warning'
                          : 'bg-destructive/10 text-destructive'
                    }
                  >
                    {conversionRate}%
                  </Badge>
                </td>
                <td className="border-r border-border px-4 py-3 text-sm font-mono font-semibold tabular-nums text-foreground">
                  {rep.commissionRate ?? 10}%
                </td>
                <td className="border-r border-border px-4 py-3 text-sm">
                  <Badge variant="secondary" className={STATUS_COLORS[rep.status] || STATUS_COLORS.verified}>
                    {rep.status ? rep.status.charAt(0).toUpperCase() + rep.status.slice(1) : 'Inactive'}
                  </Badge>
                </td>
                <td className="border-r border-border px-4 py-3 text-sm text-muted-foreground">
                  {rep.lastLogin ? formatDate(rep.lastLogin) : <span className="text-muted-foreground/70 italic">Never</span>}
                </td>
                <td className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap gap-1">
                    {rep.accountStatus === 'pending_email_verification' && (
                      <Button variant="ghost" size="icon-sm" title="Resend Invitation Email" onClick={() => onResendInvite?.(rep)}>
                        <Mail className="size-4" />
                      </Button>
                    )}

                    {(rep.accountStatus === 'verified' || rep.accountStatus === 'pending_password_reset') && (
                      <Button variant="ghost" size="icon-sm" title="Force Password Reset" onClick={() => onForcePasswordReset?.(rep)}>
                        <Key className="size-4" />
                      </Button>
                    )}

                    <Button variant="ghost" size="icon-sm" title="Edit" onClick={() => onEdit(rep)}>
                      <Edit className="size-4" />
                    </Button>

                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title="Delete"
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => onDelete(rep)}
                    >
                      <Trash className="size-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {reps.length === 0 && (
        <div className="py-12 text-center text-muted-foreground">
          <p className="text-lg">No sales representatives found</p>
        </div>
      )}
    </div>
  );
};

export default SalesRepTable;
