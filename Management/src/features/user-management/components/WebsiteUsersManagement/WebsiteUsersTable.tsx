import { Edit, Trash, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { STATUS_COLORS } from '../../utils/constants';
import { formatDate } from '../../utils/helpers';
import type { WebsiteUser } from '../../hooks/useWebsiteUsers';

export interface WebsiteUsersTableProps {
  users: WebsiteUser[];
  onEdit: (user: WebsiteUser) => void;
  onDelete: (user: WebsiteUser) => void;
  onToggleStatus: (user: WebsiteUser) => void;
  loading?: boolean;
}

const WebsiteUsersTable = ({ users, onEdit, onDelete, onToggleStatus, loading }: WebsiteUsersTableProps) => {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-card">
      <table className="min-w-full divide-y divide-border">
        <thead className="bg-muted/50">
          <tr>
            <th className="border-r border-border px-4 py-3 text-left text-xs font-bold tracking-wider text-muted-foreground uppercase">Name</th>
            <th className="border-r border-border px-4 py-3 text-left text-xs font-bold tracking-wider text-muted-foreground uppercase">Email</th>
            <th className="border-r border-border px-4 py-3 text-left text-xs font-bold tracking-wider text-muted-foreground uppercase">Phone</th>
            <th className="border-r border-border px-4 py-3 text-left text-xs font-bold tracking-wider text-muted-foreground uppercase">Bookings</th>
            <th className="border-r border-border px-4 py-3 text-left text-xs font-bold tracking-wider text-muted-foreground uppercase">Total Spent</th>
            <th className="border-r border-border px-4 py-3 text-left text-xs font-bold tracking-wider text-muted-foreground uppercase">Joined</th>
            <th className="border-r border-border px-4 py-3 text-left text-xs font-bold tracking-wider text-muted-foreground uppercase">Last Login</th>
            <th className="border-r border-border px-4 py-3 text-left text-xs font-bold tracking-wider text-muted-foreground uppercase">Email Verification</th>
            <th className="border-r border-border px-4 py-3 text-left text-xs font-bold tracking-wider text-muted-foreground uppercase">Status</th>
            <th className="px-4 py-3 text-left text-xs font-bold tracking-wider text-muted-foreground uppercase">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {loading ? (
            <tr>
              <td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">
                <p>Loading users...</p>
              </td>
            </tr>
          ) : users.length === 0 ? (
            <tr>
              <td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">
                <p className="text-lg">No users found</p>
              </td>
            </tr>
          ) : (
            users.map((user) => (
              <tr key={user.id} className="transition-colors hover:bg-muted/50">
                <td className="border-r border-border px-4 py-3 text-sm font-semibold text-foreground">{user.name}</td>
                <td className="border-r border-border px-4 py-3 text-sm text-muted-foreground">{user.email}</td>
                <td className="border-r border-border px-4 py-3 text-sm text-muted-foreground">{user.phone}</td>
                <td className="border-r border-border px-4 py-3 text-sm">
                  <Badge variant="secondary">{(user.bookings as number) ?? 0}</Badge>
                </td>
                <td className="border-r border-border px-4 py-3 text-sm font-mono font-semibold tabular-nums text-foreground">
                  ${((user.totalSpent as number) ?? 0).toLocaleString()}
                </td>
                <td className="border-r border-border px-4 py-3 text-sm text-muted-foreground">{formatDate(user.createdAt as string)}</td>
                <td className="border-r border-border px-4 py-3 text-sm text-muted-foreground">
                  {user.lastLogin ? formatDate(user.lastLogin as string) : 'Never'}
                </td>
                <td className="border-r border-border px-4 py-3 text-sm">
                  <Badge
                    variant="secondary"
                    className={user.isEmailVerified === true ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}
                  >
                    {user.isEmailVerified === true ? 'Verified' : 'Unverified'}
                  </Badge>
                </td>
                <td className="border-r border-border px-4 py-3 text-sm">
                  <Badge variant="secondary" className={STATUS_COLORS[user.status] || STATUS_COLORS.active}>
                    {user.status.charAt(0).toUpperCase() + user.status.slice(1)}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-sm">
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={loading}
                      title={user.status === 'active' ? 'Deactivate' : 'Activate'}
                      className={user.status === 'active' ? 'text-destructive hover:bg-destructive/10 hover:text-destructive' : 'text-success hover:bg-success/10 hover:text-success'}
                      onClick={() => onToggleStatus(user)}
                    >
                      {user.status === 'active' ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </Button>
                    <Button variant="ghost" size="icon-sm" disabled={loading} title="Edit" onClick={() => onEdit(user)}>
                      <Edit className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={loading}
                      title="Delete"
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => onDelete(user)}
                    >
                      <Trash className="size-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
};

export default WebsiteUsersTable;
