import { useState } from 'react';
import {
  Users, UserCheck, UserX, TrendingUp, ChevronRight,
  Search, Loader2,
} from 'lucide-react';
import { leadAPI } from '../../../services/api';
import toast from '@/lib/toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { formatPercent } from '@/utils/number';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import type { LucideIcon } from 'lucide-react';
import { StatCard } from '@/components/shared/StatCard';
import { repLabelFor } from '../utils/salesRepLabel';

interface StatSummary {
  total: number;
  assigned: number;
  unassigned: number;
  converted: number;
  conversionRate: string | number;
}

interface SalesRep {
  id: string;
  name: string;
}

interface LeadStatsProps {
  summary?: StatSummary;
  salesReps: SalesRep[];
  onAssignSuccess?: () => void;
}

type StatKey = 'total' | 'assigned' | 'unassigned' | 'conversion';

const LeadStats = ({ summary, salesReps, onAssignSuccess }: LeadStatsProps) => {
  const [showModal, setShowModal] = useState(false);
  const [modalType, setModalType] = useState<StatKey | null>(null);
  const [modalLeads, setModalLeads] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedRep, setSelectedRep] = useState('');
  const [assigningLeads, setAssigningLeads] = useState<Record<string, boolean>>({});

  // Fallback if summary is not yet loaded
  const stats = summary || { total: 0, assigned: 0, unassigned: 0, converted: 0, conversionRate: '0.0' };

  const handleStatClick = async (type: StatKey) => {
    try {
      const pageSize = 100;
      const firstResponse = await leadAPI.getAllLeads({ page: 1, limit: pageSize } as any);
      const apiLeads: any[] = Array.isArray(firstResponse.data)
        ? firstResponse.data
        : firstResponse.data?.leads || [];
      const pageCount = Number(firstResponse.pagination?.pages) || 1;

      for (let page = 2; page <= pageCount; page += 1) {
        const response = await leadAPI.getAllLeads({ page, limit: pageSize } as any);
        const pageLeads = Array.isArray(response.data) ? response.data : response.data?.leads || [];
        apiLeads.push(...pageLeads);
      }

      let filtered: any[];
      // 'converted' was dead code here in the original: handleStatClick's
      // `type` param only ever receives 'total'/'assigned'/'unassigned' (the
      // 'conversion' stat tile is non-clickable), so this branch could never
      // fire - confirmed by TS's real type-checking, not guessed.
      if (type === 'total') filtered = apiLeads;
      else if (type === 'assigned') filtered = apiLeads.filter((lead: any) => Boolean(lead.assignedToId));
      else if (type === 'unassigned') filtered = apiLeads.filter((lead: any) => !lead.assignedToId);
      else filtered = [];

      setModalType(type);
      setModalLeads(filtered);
      setShowModal(true);
      setSearchTerm('');
      setSelectedRep('');
    } catch (e) {
      toast.error('Failed to load leads list');
    }
  };

  const handleAssign = async (leadId: string, repId: string) => {
    if (!repId) return;
    setAssigningLeads((prev) => ({ ...prev, [leadId]: true }));
    try {
      await leadAPI.assignLead(leadId, repId);
      toast.success('Lead assigned successfully');
      onAssignSuccess?.();
      setModalLeads((prev) => prev.filter((l) => (l._id || l.id) !== leadId));
    } catch (err) {
      toast.error('Failed to assign lead');
    } finally {
      setAssigningLeads((prev) => ({ ...prev, [leadId]: false }));
    }
  };

  const filteredModalLeads = modalLeads.filter((lead) => {
    const search = searchTerm.toLowerCase();
    return (
      (lead.name || '').toLowerCase().includes(search) ||
      (lead.email || '').toLowerCase().includes(search) ||
      (lead.phone || '').includes(search)
    );
  });

  const statCards: { key: StatKey; label: string; value: string | number; icon: LucideIcon; color: 'muted' | 'success' | 'warning' | 'primary'; clickable?: boolean }[] = [
    { key: 'total', label: 'Total Leads', value: stats.total, icon: Users, color: 'muted' },
    { key: 'assigned', label: 'Assigned', value: stats.assigned, icon: UserCheck, color: 'success' },
    { key: 'unassigned', label: 'Unassigned', value: stats.unassigned, icon: UserX, color: 'warning' },
    { key: 'conversion', label: 'Conversion Rate', value: formatPercent(stats.conversionRate), icon: TrendingUp, color: 'primary', clickable: false },
  ];

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {statCards.map((stat) => {
          const Icon = stat.icon;
          const isClickable = stat.clickable !== false && stat.key !== 'conversion';

          return (
            <div
              key={stat.key}
              role={isClickable ? 'button' : undefined}
              tabIndex={isClickable ? 0 : undefined}
              aria-label={isClickable ? `Show ${stat.label.toLowerCase()} leads` : undefined}
              onClick={() => isClickable && handleStatClick(stat.key)}
              onKeyDown={(event) => {
                if (!isClickable || (event.key !== 'Enter' && event.key !== ' ')) return;
                event.preventDefault();
                void handleStatClick(stat.key);
              }}
              className={isClickable ? 'h-full cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2' : 'h-full'}
            >
              <StatCard
                icon={Icon}
                label={stat.label}
                value={stat.value}
                color={stat.color}
                trailingIcon={isClickable ? ChevronRight : undefined}
                className={`h-full ${isClickable ? 'cursor-pointer transition-shadow hover:shadow-[var(--shadow-card)]' : ''}`}
              />
            </div>
          );
        })}
      </div>

      {/* Modal */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="capitalize">{modalType} Leads</DialogTitle>
            <DialogDescription>{filteredModalLeads.length} leads</DialogDescription>
          </DialogHeader>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search leads..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>

          {/* Content */}
          <div className="overflow-y-auto flex-1 -mx-6 px-6">
            {filteredModalLeads.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                <Users className="w-10 h-10 mx-auto mb-3 text-muted-foreground/50" />
                <p>No leads found</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {filteredModalLeads.map((lead) => {
                  const leadId = lead._id || lead.id;
                  const isAssigning = assigningLeads[leadId];

                  return (
                    <div key={leadId} className="py-4 hover:bg-muted/50">
                      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-4">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-foreground truncate">{lead.name}</p>
                          <p className="text-sm text-muted-foreground truncate">
                            {lead.phone} • {lead.destination || 'No destination'}
                          </p>
                        </div>

                        {modalType === 'unassigned' && (
                          <div className="flex items-center gap-2 shrink-0">
                            <Select value={selectedRep} onValueChange={(value) => setSelectedRep(String(value))}>
                              <SelectTrigger className="w-40">
                                <SelectValue placeholder="Select Rep">
                                  {(value: string) => salesReps.find((r) => r.id === value)?.name ?? value}
                                </SelectValue>
                              </SelectTrigger>
                              <SelectContent>
                                {salesReps.map((rep) => (
                                  <SelectItem key={rep.id} value={rep.id}>{rep.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Button
                              size="sm"
                              onClick={() => handleAssign(leadId, selectedRep)}
                              disabled={!selectedRep || isAssigning}
                            >
                              {isAssigning ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Assign'}
                            </Button>
                          </div>
                        )}

                        {modalType !== 'unassigned' && (
                          <span className="text-sm text-muted-foreground">
                            {repLabelFor(lead.assignedToId, salesReps)}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default LeadStats;
