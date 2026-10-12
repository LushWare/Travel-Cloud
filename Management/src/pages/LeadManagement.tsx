import { useState, useEffect } from "react";
import {
  Plus,
  RefreshCw,
  Settings,
  Loader2,
  AlertCircle,
  Users,
  LayoutGrid,
  List,
} from "lucide-react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { leadAPI, adminAPI, authAPI } from "../services/api";
import toast from '@/lib/toast';
import LeadStats from "../features/lead-management/components/LeadStats";
import LeadFilters from "../features/lead-management/components/LeadFilters";
import LeadTable from "../features/lead-management/components/LeadTable";
import NewLeadDialog from "../features/lead-management/components/NewLeadDialog";
import EditLeadDialog from "../features/lead-management/components/EditLeadDialog";
import RemarksDialog from "../features/lead-management/components/RemarksDialog";
import WhatsAppHistoryDialog from "../features/lead-management/components/WhatsAppHistoryDialog";
import FilterDialog from "../features/lead-management/components/FilterDialog";
import SettingsDialog from "../features/lead-management/components/SettingsDialog";
import StatusChangeDialog from "../features/lead-management/components/StatusChangeDialog";
import QuotationModal from "../features/lead-management/components/quotation/QuotationModal";
import InvoiceDialog from "../features/lead-management/components/InvoiceDialog";
import ReceiptDialog from "../features/lead-management/components/ReceiptDialog";
import VoucherDialog from "../features/lead-management/components/VoucherDialog";
import LeadSectionView from "../features/lead-management/components/LeadSectionView";
import LeadDetailPane from "../features/lead-management/components/LeadDetailPane";
import ActiveSalesRepsDialog from "../features/lead-management/components/ActiveSalesRepsDialog";
import { LIFECYCLE_STATUS_COLORS, LIFECYCLE_STATUS_LABELS } from "../features/lead-management/components/LeadStatusBadge";
import type { LifecycleStatus } from "../features/lead-management/components/LeadStatusBadge";
type FilterKey = 'all' | LifecycleStatus;
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiErrorMessage } from '@/lib/apiErrorMessage';
import PageHeader from '@/components/PageHeader';
import RecommendationStrip from '@/features/recommendations/RecommendationStrip';

// Lifecycle status maps (10 states) plus old-status fallbacks
const statusColors: Record<string, string> = {
  ...LIFECYCLE_STATUS_COLORS,
  new: "bg-primary/10 text-primary",
  contacted: "bg-warning/10 text-warning",
  interested: "bg-primary/10 text-primary",
  quoted: "bg-primary/10 text-primary",
  converted: "bg-success/10 text-success",
  lost: "bg-destructive/10 text-destructive",
  not_interested: "bg-muted text-muted-foreground",
};

const statusLabels: Record<string, string> = {
  ...LIFECYCLE_STATUS_LABELS,
  new: "New",
  contacted: "Contacted",
  interested: "Interested",
  quoted: "Quoted",
  converted: "Converted",
  lost: "Lost",
  not_interested: "Not Interested",
};

const LeadManagement = () => {
  const [leads, setLeads] = useState<any[]>([]);
  const [totalLeads, setTotalLeads] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<FilterKey>("all");
  const [filterTravelDateStart, setFilterTravelDateStart] = useState("");
  const [filterTravelDateEnd, setFilterTravelDateEnd] = useState("");
  const [filterPlatforms, setFilterPlatforms] = useState<string[]>([]);
  const [filterSources, setFilterSources] = useState<string[]>([]);
  const [filterAi, setFilterAi] = useState<string[]>([]);

  const [statsSummary, setStatsSummary] = useState<any>(null);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({ all: 0 });

  const [showNewDialog, setShowNewDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showRemarksDialog, setShowRemarksDialog] = useState(false);
  const [showWhatsappDialog, setShowWhatsappDialog] = useState(false);
  const [showFilterDialog, setShowFilterDialog] = useState(false);
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [showActiveSalesRepsDialog, setShowActiveSalesRepsDialog] = useState(false);
  const [showStatusDialog, setShowStatusDialog] = useState(false);
  // Each billing document dialog owns its own lead so opening one for a
  // different lead can never leak into a dialog that's already open.
  const [quotationLead, setQuotationLead] = useState<any>(null);
  const [invoiceLead, setInvoiceLead] = useState<any>(null);
  const [receiptLead, setReceiptLead] = useState<any>(null);
  const [voucherLead, setVoucherLead] = useState<any>(null);

  const [selectedLead, setSelectedLead] = useState<any>(null);
  const [statusLead, setStatusLead] = useState<any>(null);
  const [sectionLead, setSectionLead] = useState<any>(null);
  // The lead selected into the persistent detail pane. This — not the documents
  // dialog below — owns the copilot scope: clearing it unmounts the session.
  const [detailLead, setDetailLead] = useState<any>(null);
  // When set, the lead editor was opened from the quotation flow and we return
  // to the quotation modal once the editor closes.
  const [resumeQuoteLead, setResumeQuoteLead] = useState<any>(null);
  const [resumeQuoteSelectionId, setResumeQuoteSelectionId] = useState<string | null>(null);
  // Same hand-off, for the voucher flow's "Manage flights & itinerary" backlink.
  const [resumeVoucherLead, setResumeVoucherLead] = useState<any>(null);
  const [resumeVoucherSelectionId, setResumeVoucherSelectionId] = useState<string | null>(null);
  // Which package tab to open the lead editor/quotation modal on, carried
  // across the quotation <-> lead-editor hand-off so edits land on the same
  // package the user was viewing instead of defaulting to the first one.
  const [editorInitialSelectionId, setEditorInitialSelectionId] = useState<string | null>(null);
  const [quotationInitialSelectionId, setQuotationInitialSelectionId] = useState<string | null>(null);
  const [voucherInitialSelectionId, setVoucherInitialSelectionId] = useState<string | null>(null);
  const [showSectionView, setShowSectionView] = useState(false);

  const [currentPage, setCurrentPage] = useState(1);
  const [salesReps, setSalesReps] = useState<any[]>([]);
  const [assignmentSettings, setAssignmentSettings] = useState<{
    mode: 'auto' | 'manual';
    strategy: 'round-robin' | 'load-based';
    requireActiveLogin: boolean;
  }>({
    mode: "manual",
    strategy: "round-robin",
    requireActiveLogin: false,
  });
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const highlightedLeadId = searchParams.get("leadId");
  const idsParam = searchParams.get("ids");
  const recommendationFocus = searchParams.get('focus') === 'recommendation';
  const shouldOpenLead = searchParams.get("open") === "1";

  const currentUser = authAPI.getStoredUser();
  const canDelete = currentUser?.role === 'admin' || currentUser?.role === 'super-admin' || currentUser?.role === 'superadmin' || currentUser?.role === 'super_admin';
  // Reassigning a lead that already has an owner is an admin action. The service
  // enforces the same rule; this only decides whether to offer the control.
  const canChangeAssignment = canDelete || currentUser?.isSuperAdmin === true;

  const handleDeleteLead = async (leadId: string) => {
    try {
      const response = await leadAPI.deleteLead(leadId);
      if (response.success) {
        toast.success("Lead deleted successfully");
        fetchLeads();
        fetchLeadStats();
      } else {
        toast.error(response.message || "Failed to delete lead");
      }
    } catch (err: any) {
      toast.error(apiErrorMessage(err));
    }
  };

  // Mobile responsive view mode auto-detection
  const [viewMode, setViewMode] = useState<'table' | 'grid'>(window.innerWidth < 1024 ? 'grid' : 'table');

  const leadsPerPage = 12;

  // Handle window resize for responsive view
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1024) {
        setViewMode('grid');
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Debounce Search Term to prevent spamming the API
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
      setCurrentPage(1); // Reset to first page on new search
    }, 500);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Refetch leads when filters or page change
  useEffect(() => {
    fetchLeads();
    fetchLeadStats();
  }, [debouncedSearch, filterStatus, filterTravelDateStart, filterTravelDateEnd, filterPlatforms, filterSources, filterAi, currentPage, idsParam]);

  useEffect(() => {
    if (!idsParam || !recommendationFocus || loading) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById('recommendation-target')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [idsParam, recommendationFocus, loading, leads]);

  useEffect(() => {
    if (!shouldOpenLead || !highlightedLeadId) return;
    const requested = leads.find((lead) => String(lead._id || lead.id) === highlightedLeadId);
    if (requested) setDetailLead(requested);
  }, [highlightedLeadId, leads, shouldOpenLead]);

  useEffect(() => {
    fetchSalesReps();
    fetchAssignmentSettings();
    fetchLeadStats();
  }, []);

  const fetchLeadStats = async () => {
    try {
      const response = await leadAPI.getLeadStats();
      if (response.success) {
        setStatsSummary(response.summary || null);
        const transformedCounts: Record<string, number> = { all: response.summary?.total || 0 };
        (response.data || []).forEach((item: any) => {
          transformedCounts[item._id] = item.count;
        });
        setStatusCounts(transformedCounts);
      }
    } catch (e) {
      console.error("Failed to load stats", e);
    }
  };

  const fetchLeads = async () => {
    try {
      setLoading(true);
      setError(null);
      const params: Record<string, any> = idsParam
        ? { ids: idsParam, limit: 200, page: 1 }
        : { limit: leadsPerPage, page: currentPage };

      if (!idsParam) {
        if (debouncedSearch) params.query = debouncedSearch; // The backend uses ?query= for search
        if (filterStatus !== "all") {
          // PENDING_VERIFICATION is a carve-out visible to any salesRep — the
          // backend gates it behind ?lifecycleStatus= (design doc #8), not the
          // ownership-filtered ?status= path.
          if (filterStatus === 'PENDING_VERIFICATION') {
            params.lifecycleStatus = filterStatus;
          } else {
            params.status = filterStatus;
          }
        }
        if (filterTravelDateStart) params['travelDate[gte]'] = filterTravelDateStart;
        if (filterTravelDateEnd) params['travelDate[lte]'] = filterTravelDateEnd;
        if (filterSources.length > 0) params.source = filterSources.join(',');
        if (filterPlatforms.length > 0) params.platform = filterPlatforms.join(',');
        if (filterAi.includes('aiHandled')) params.aiHandled = 'true';
        if (filterAi.includes('needsRepFollowup')) params.needsRepFollowup = 'true';
        if (filterAi.includes('aiVerified')) params.aiVerified = 'true';
      }


      const response = !idsParam && debouncedSearch
        ? await leadAPI.searchLeads(debouncedSearch)
        : await leadAPI.getAllLeads(params);

      if (response.success) {
        const leadsData = Array.isArray(response.data) ? response.data : response.data?.leads || [];
        setLeads(leadsData);

        // Handle pagination metadata from server
        if (response.pagination) {
          setTotalPages(response.pagination.pages || 1);
          setTotalLeads(response.pagination.total || leadsData.length);
        } else {
          // Fallback if search endpoint doesn't return pagination
          setTotalPages(1);
          setTotalLeads(response.count || leadsData.length);
        }
      } else {
        setLeads([]);
      }
    } catch (err: any) {
      setError(apiErrorMessage(err));
      console.error("Error fetching leads:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchSalesReps = async () => {
    try {
      const response = await adminAPI.getSalesReps();
      if (response.success || response.status === 'success') {
        const repsData = Array.isArray(response.data)
          ? response.data
          : (response.data?.users || []);
        const formattedReps = repsData.map((rep: any) => ({
          id: rep._id || rep.id,
          _id: rep._id || rep.id,
          name: rep.name || rep.fullName || "Unknown",
          email: rep.email || "",
          isActive: rep.isActive !== false,
          isLoggedIn: rep.isLoggedIn || false,
        }));
        setSalesReps(formattedReps);
      }
    } catch (err) { /* non-fatal - sales rep list stays empty */ }
  };

  const fetchAssignmentSettings = async () => {
    try {
      const response = await leadAPI.getAssignmentSettings();
      if (response.success && response.data) {
        const data = response.data;
        setAssignmentSettings({
          mode: data.assignmentMode === 'auto' ? 'auto' : 'manual',
          strategy: data.autoStrategy === 'load_based' ? 'load-based' : 'round-robin',
          requireActiveLogin: data.requireActiveLogin48h || false,
        });
      }
    } catch (err) { /* non-fatal - assignment settings stay at their default */ }
  };

  const goToPage = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handleLeadSuccess = () => {
    fetchLeads();
    if (highlightedLeadId) {
      setSearchParams({});
    }
  };

  // Quotation/Invoice/Receipt/Voucher each own their lead state, but share
  // this same refetch-and-clear-highlight behavior on success.
  const handleQuotationSuccess = () => {
    fetchLeads();
    if (highlightedLeadId) setSearchParams({});
  };
  const handleInvoiceSuccess = () => {
    fetchLeads();
    if (highlightedLeadId) setSearchParams({});
  };
  const handleReceiptSuccess = () => {
    fetchLeads();
    if (highlightedLeadId) setSearchParams({});
  };
  const handleVoucherSuccess = () => {
    fetchLeads();
    if (highlightedLeadId) setSearchParams({});
  };

  // Hand off from the quotation modal to the lead editor, remembering to return
  // to the quotation flow once editing is done.
  const openLeadEditorFromQuote = (lead: any, selectionId?: string | null) => {
    setQuotationLead(null);
    setResumeQuoteLead(lead);
    setResumeQuoteSelectionId(selectionId ?? null);
    setEditorInitialSelectionId(selectionId ?? null);
    setSelectedLead(lead);
    setShowEditDialog(true);
  };

  const openLeadEditorFromVoucher = (lead: any, selectionId?: string | null) => {
    setVoucherLead(null);
    setResumeVoucherLead(lead);
    setResumeVoucherSelectionId(selectionId ?? null);
    setEditorInitialSelectionId(selectionId ?? null);
    setSelectedLead(lead);
    setShowEditDialog(true);
  };

  const closeLeadEditor = () => {
    setShowEditDialog(false);
    setSelectedLead(null);
    setEditorInitialSelectionId(null);
    if (resumeQuoteLead) {
      setQuotationInitialSelectionId(resumeQuoteSelectionId);
      setQuotationLead(resumeQuoteLead);
      setResumeQuoteLead(null);
      setResumeQuoteSelectionId(null);
    } else if (resumeVoucherLead) {
      setVoucherInitialSelectionId(resumeVoucherSelectionId);
      setVoucherLead(resumeVoucherLead);
      setResumeVoucherLead(null);
      setResumeVoucherSelectionId(null);
    }
  };

  const handleStatusChange = async (lead: any, newStatus: string, reason?: string) => {
    try {
      const leadId = lead._id || lead.id;
      const payload: Record<string, any> = { lifecycleStatus: newStatus };
      if (reason) payload.lostReason = reason;
      await leadAPI.updateLead(leadId, payload);
      toast.success("Status updated successfully");
      fetchLeads();
      fetchLeadStats();
    } catch (err: any) {
      toast.error(apiErrorMessage(err));
    }
    setShowStatusDialog(false);
    setStatusLead(null);
  };

  const handleClaimLead = async (lead: any) => {
    try {
      const leadId = lead._id || lead.id;
      await leadAPI.claimLead(leadId);
      toast.success("Lead claimed successfully");
      fetchLeads();
      fetchLeadStats();
    } catch (err: any) {
      toast.error(apiErrorMessage(err));
    }
  };

  const handleAssignLead = async (leadId: string, repId: string) => {
    try {
      await leadAPI.assignLead(leadId, repId);
      toast.success("Lead assigned successfully");
      fetchLeads();
      fetchLeadStats();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  return (
    <div className="bg-background">
        {/* The header sits inside the content column, and the column is exactly
            one viewport tall (h-dvh, not min-h-dvh) with the body below scrolling
            inside it. Two reasons: CopilotDock beside it is a full-viewport-tall
            sticky column, so an unbounded column would make the page taller than
            the viewport and reveal a blank band beside the sidebar; and matching
            heights is what keeps the two columns looking deliberately paired
            rather than one towering over a short list. */}
        <div className="flex h-dvh flex-col">
          <PageHeader
            title="Lead Management"
            subtitle="Track and manage your leads efficiently"
            actions={
              <>
                <Tabs value={viewMode} onValueChange={(value) => value && setViewMode(value as 'table' | 'grid')}>
                  <TabsList>
                    <TabsTrigger value="table" aria-label="Table view">
                      <List className="w-4 h-4" />
                    </TabsTrigger>
                    <TabsTrigger value="grid" aria-label="Grid view">
                      <LayoutGrid className="w-4 h-4" />
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
                <Button onClick={fetchLeads} disabled={loading} variant="outline">
                  <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                  <span className="hidden sm:inline">Refresh</span>
                </Button>
                <Button onClick={() => setShowSettingsDialog(true)} variant="outline">
                  <Settings className="w-4 h-4" />
                  <span className="hidden sm:inline">
                    {assignmentSettings.mode === "auto" ? `Auto: ${assignmentSettings.strategy}` : "Manual"}
                  </span>
                </Button>
                <Button onClick={() => setShowNewDialog(true)}>
                  <Plus className="w-4 h-4" />
                  <span className="hidden sm:inline">New Lead</span>
                </Button>
              </>
            }
          />

          {/* `[&>*]:shrink-0` keeps each section at its natural height. Without it
              this flex column shrinks its tallest children to fit one viewport
              instead of scrolling: the filters card collapsed to 131px (hiding the
              Source/Platform chips behind its own overflow-hidden) and the table to
              250px (7 of 11 rows behind an inner scrollbar). The column is meant to
              scroll — that is what the overflow-y-auto is for. */}
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6 [&>*]:shrink-0">
            {/* Stats Cards */}
            <LeadStats
              summary={statsSummary}
              salesReps={salesReps}
              onAssignSuccess={() => { fetchLeads(); fetchLeadStats(); }}
            />
            <RecommendationStrip module="leads" />

            {idsParam ? (
              <div className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
                <p className="text-sm text-foreground">
                  Active filter: linked leads <span className="font-mono tabular-nums">({totalLeads})</span>
                </p>
                <Button variant="ghost" size="xs" onClick={() => setSearchParams({})}>
                  Clear filter
                </Button>
              </div>
            ) : (
              <LeadFilters
                searchTerm={searchTerm}
                setSearchTerm={setSearchTerm}
                filterStatus={filterStatus}
                setFilterStatus={setFilterStatus}
                statusCounts={statusCounts}
                filterSources={filterSources}
                setFilterSources={setFilterSources}
                filterPlatforms={filterPlatforms}
                setFilterPlatforms={setFilterPlatforms}
                filterAi={filterAi}
                setFilterAi={setFilterAi}
                onAdvancedFilterClick={() => setShowFilterDialog(true)}
              />
            )}

            {/* Persistent record surface: the Evidence Lens reveals into these anchors. */}
            <LeadDetailPane lead={detailLead} salesReps={salesReps} onClose={() => setDetailLead(null)} />

            {/* Lead Cards Grid */}
            <div id="recommendation-target" className="scroll-mt-20">
            {!loading && !error && leads.length > 0 && (
              <LeadTable
                viewMode={viewMode}
                leads={leads}
                loading={loading}
                error={error}
                statusColors={statusColors}
                statusLabels={statusLabels}
                onLeadClick={(lead: any) => setDetailLead(lead)}
                onRemarksClick={(lead: any) => {
                  setSelectedLead(lead);
                  setShowRemarksDialog(true);
                }}
                onWhatsappClick={(lead: any) => {
                  setSelectedLead(lead);
                  setShowWhatsappDialog(true);
                }}
                onEditClick={(lead: any) => {
                  setSelectedLead(lead);
                  setShowEditDialog(true);
                }}
                onStatusClick={(lead: any) => {
                  setStatusLead(lead);
                  setShowStatusDialog(true);
                }}
                onQuotationClick={(lead: any) => setQuotationLead(lead)}
                onInvoiceClick={(lead: any) => setInvoiceLead(lead)}
                onReceiptClick={(lead: any) => setReceiptLead(lead)}
                onVoucherClick={(lead: any) => setVoucherLead(lead)}
                onSectionClick={(lead: any) => {
                  setSectionLead(lead);
                  setShowSectionView(true);
                }}
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={goToPage}
                leadsPerPage={leadsPerPage}
                totalLeads={totalLeads}
                highlightedLeadId={highlightedLeadId}
                canDelete={canDelete}
                onClaimClick={handleClaimLead}
                onDeleteClick={handleDeleteLead}
                salesReps={salesReps}
                onAssign={handleAssignLead}
                canChangeAssignment={canChangeAssignment}
              />
            )}
            </div>

            {/* flex-1 so each state fills what is left of the column: with few or no
                leads that centres it rather than leaving a large gap beneath. */}
            {loading && (
              <div className="flex flex-1 flex-col items-center justify-center py-20 bg-card rounded-xl border border-border">
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
                <p className="mt-3 text-muted-foreground">Loading leads...</p>
              </div>
            )}

            {error && !loading && (
              <div className="flex flex-1 flex-col items-center justify-center py-16 bg-card rounded-xl border border-destructive/30">
                <AlertCircle className="w-12 h-12 text-destructive mb-3" />
                <p className="text-destructive font-medium">{error}</p>
                <Button onClick={fetchLeads} variant="destructive" className="mt-4">
                  Try Again
                </Button>
              </div>
            )}

            {!loading && !error && leads.length === 0 && (
              <div className="flex flex-1 flex-col items-center justify-center py-20 bg-card rounded-xl border border-border">
                <Users className="w-12 h-12 text-muted-foreground/40 mb-4" />
                <p className="text-muted-foreground font-medium">No leads found</p>
                <p className="text-muted-foreground/70 text-sm mt-1">
                  {searchTerm || filterStatus !== "all"
                    ? "Try adjusting your filters"
                    : "Create your first lead to get started"}
                </p>
                {!searchTerm && filterStatus === "all" && (
                  <Button onClick={() => setShowNewDialog(true)} className="mt-4">
                    <Plus className="w-4 h-4" />
                    Create Lead
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      {/* Dialogs */}
      <NewLeadDialog
        isOpen={showNewDialog}
        onClose={() => setShowNewDialog(false)}
        salesReps={salesReps}
        onSuccess={handleLeadSuccess}
      />

      <EditLeadDialog
        isOpen={showEditDialog}
        onClose={closeLeadEditor}
        lead={selectedLead}
        salesReps={salesReps}
        onSuccess={handleLeadSuccess}
        initialSelectionId={editorInitialSelectionId ?? undefined}
      />

      <RemarksDialog
        isOpen={showRemarksDialog}
        onClose={() => {
          setShowRemarksDialog(false);
          setSelectedLead(null);
        }}
        lead={selectedLead}
        onSuccess={handleLeadSuccess}
      />

      <WhatsAppHistoryDialog
        isOpen={showWhatsappDialog}
        onClose={() => {
          setShowWhatsappDialog(false);
          setSelectedLead(null);
        }}
        lead={selectedLead}
        onSuccess={handleLeadSuccess}
      />

      <FilterDialog
        isOpen={showFilterDialog}
        onClose={() => setShowFilterDialog(false)}
        filterTravelDateStart={filterTravelDateStart}
        setFilterTravelDateStart={setFilterTravelDateStart}
        filterTravelDateEnd={filterTravelDateEnd}
        setFilterTravelDateEnd={setFilterTravelDateEnd}
        filterPlatforms={filterPlatforms}
        setFilterPlatforms={setFilterPlatforms}
      />

      <SettingsDialog
        isOpen={showSettingsDialog}
        onClose={() => setShowSettingsDialog(false)}
        assignmentSettings={assignmentSettings}
        setAssignmentSettings={setAssignmentSettings}
        salesReps={salesReps}
        onViewActiveSalesReps={() => {
          setShowSettingsDialog(false);
          setShowActiveSalesRepsDialog(true);
        }}
      />

      <ActiveSalesRepsDialog
        isOpen={showActiveSalesRepsDialog}
        onClose={() => setShowActiveSalesRepsDialog(false)}
        requireActiveLogin48h={assignmentSettings.requireActiveLogin}
      />

      <StatusChangeDialog
        isOpen={showStatusDialog}
        onClose={() => {
          setShowStatusDialog(false);
          setStatusLead(null);
        }}
        lead={statusLead}
        statusLabels={statusLabels}
        statusColors={statusColors}
        onStatusChange={handleStatusChange}
      />

      {quotationLead && (
        <QuotationModal
          isOpen
          onClose={() => {
            setQuotationLead(null);
            setQuotationInitialSelectionId(null);
          }}
          lead={quotationLead}
          onSuccess={handleQuotationSuccess}
          onEditLead={openLeadEditorFromQuote}
          initialSelectionId={quotationInitialSelectionId ?? undefined}
        />
      )}

      {invoiceLead && (
        <InvoiceDialog
          isOpen
          onClose={() => setInvoiceLead(null)}
          lead={invoiceLead}
          onSuccess={handleInvoiceSuccess}
        />
      )}

      {receiptLead && (
        <ReceiptDialog
          isOpen
          onClose={() => setReceiptLead(null)}
          lead={receiptLead}
          onSuccess={handleReceiptSuccess}
        />
      )}

      {voucherLead && (
        <VoucherDialog
          isOpen
          onClose={() => {
            setVoucherLead(null);
            setVoucherInitialSelectionId(null);
          }}
          lead={voucherLead}
          onSuccess={handleVoucherSuccess}
          onEditLead={openLeadEditorFromVoucher}
          initialSelectionId={voucherInitialSelectionId ?? undefined}
        />
      )}

      {showSectionView && sectionLead && (
        <LeadSectionView
          lead={sectionLead}
          onClose={() => {
            setShowSectionView(false);
            setSectionLead(null);
          }}
        />
      )}
    </div>
  );
};

export default LeadManagement;
