import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from '@/lib/toast';
import {
  Search,
  Download,
  Eye,
  Send,
  Receipt as ReceiptIcon,
  FileText,
  FileCheck,
  Ticket,
  History,
  Calendar,
  Sparkles,
  Filter,
  LayoutGrid,
  Table as TableIcon,
} from 'lucide-react';
import { invoiceAPI, receiptAPI, quotationAPI, voucherAPI, paymentHistoryAPI } from '../../services/api.js';
import { formatCurrency } from '../../utils/currency.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable';
import StatusBadge from './StatusBadge';
import DocumentCard from './DocumentCard';
import DocumentDetailDialog from './DocumentDetailDialog';
import { getDocumentNumber, getDocumentAmount, getDocumentDate, matchesSearch, formatDate } from './helpers';
import type { BillingDocument, DocumentType, ViewMode, Quotation, Invoice, Receipt, Voucher, PaymentHistoryRecord } from './types';
import PageHeader from '@/components/PageHeader';
import RecommendationStrip from '@/features/recommendations/RecommendationStrip';

// api.js is untyped legacy JS - every one of these clients shares the same
// ApiService.fetch() foundation (typed `Promise<any>` at the source, Phase
// 6.1), so a real interface here would just restate "unknown JSON".
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped service boundary, see above
const API_MAP: Record<DocumentType, any> = {
  quotation: quotationAPI,
  invoice: invoiceAPI,
  receipt: receiptAPI,
  voucher: voucherAPI,
  'payment-history': paymentHistoryAPI,
};

const TAB_META: { id: DocumentType; label: string; shortLabel: string; icon: typeof FileCheck }[] = [
  { id: 'quotation', label: 'Quotations', shortLabel: 'Quotes', icon: FileCheck },
  { id: 'invoice', label: 'Invoices', shortLabel: 'Invoices', icon: FileText },
  { id: 'receipt', label: 'Receipts', shortLabel: 'Receipts', icon: ReceiptIcon },
  { id: 'voucher', label: 'Vouchers', shortLabel: 'Vouchers', icon: Ticket },
  { id: 'payment-history', label: 'Payment History', shortLabel: 'History', icon: History },
];

const FETCH_ERROR_LABEL: Record<DocumentType, string> = {
  quotation: 'quotations',
  invoice: 'invoices',
  receipt: 'receipts',
  voucher: 'vouchers',
  'payment-history': 'payment history',
};

const DOWNLOAD_LABEL: Record<DocumentType, string> = {
  quotation: 'quotation',
  invoice: 'invoice',
  receipt: 'receipt',
  voucher: 'voucher',
  'payment-history': 'payment history',
};

const SEND_LABEL: Record<'quotation' | 'invoice' | 'receipt' | 'voucher', string> = {
  quotation: 'quotation',
  invoice: 'invoice',
  receipt: 'receipt',
  voucher: 'voucher',
};

const docActionClass = 'rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground';

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-border border-t-primary" />
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
      <FileText className="mb-4 h-12 w-12 opacity-40" />
      <p>{message}</p>
    </div>
  );
}

export default function BillingInvoicing() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [activeTab, setActiveTab] = useState<DocumentType>(() => {
    const requested = searchParams.get('tab');
    return TAB_META.some((tab) => tab.id === requested) ? requested as DocumentType : 'quotation';
  });
  const [selected, setSelected] = useState<BillingDocument | null>(null);
  const idsParam = searchParams.get('ids');
  const recommendationFocus = searchParams.get('focus') === 'recommendation';
  const documentId = searchParams.get('documentId') || searchParams.get('invoiceId');

  const [documents, setDocuments] = useState<Record<DocumentType, BillingDocument[]>>({
    quotation: [],
    invoice: [],
    receipt: [],
    voucher: [],
    'payment-history': [],
  });
  const [loading, setLoading] = useState<Record<DocumentType, boolean>>({
    quotation: false,
    invoice: false,
    receipt: false,
    voucher: false,
    'payment-history': false,
  });

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [showDateFilter, setShowDateFilter] = useState(false);

  const changeTab = (tab: DocumentType) => {
    setActiveTab(tab);
    setSearchParams({ tab });
  };

  const fetchDocuments = async (type: DocumentType) => {
    try {
      setLoading((prev) => ({ ...prev, [type]: true }));
      const params: Record<string, string | number> = { limit: 100, page: 1 };
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;
      if (idsParam && type === activeTab) params.ids = idsParam;
      const response = await API_MAP[type].getAll(params);
      if (response.success || response.status === 'success') {
        setDocuments((prev) => ({ ...prev, [type]: response.data || [] }));
      } else {
        toast.error(`Failed to fetch ${FETCH_ERROR_LABEL[type]}`);
      }
    } catch (error) {
      console.error(`Error fetching ${type}:`, error);
      toast.error(`Failed to fetch ${FETCH_ERROR_LABEL[type]}`);
    } finally {
      setLoading((prev) => ({ ...prev, [type]: false }));
    }
  };

  useEffect(() => {
    if (!idsParam) {
      TAB_META.filter((tab) => tab.id !== activeTab).forEach((tab) => fetchDocuments(tab.id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- background fetches only change with the deep-link id set
  }, [idsParam]);

  useEffect(() => {
    fetchDocuments(activeTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch only the active tab on date/tab/id change
  }, [startDate, endDate, activeTab, idsParam]);

  useEffect(() => {
    if (!idsParam || !recommendationFocus || loading[activeTab]) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById('recommendation-target')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [idsParam, recommendationFocus, activeTab, loading]);

  useEffect(() => {
    const requested = searchParams.get('tab');
    if (requested && TAB_META.some((tab) => tab.id === requested) && requested !== activeTab) {
      setActiveTab(requested as DocumentType);
    }
  }, [activeTab, searchParams]);

  useEffect(() => {
    if (!documentId) return;
    const requested = documents[activeTab].find((document) => document.id === documentId);
    if (requested) setSelected(requested);
  }, [activeTab, documentId, documents]);

  const handleNavigateToLead = (leadId: string) => {
    if (!leadId) {
      toast.error('Lead ID not found');
      return;
    }
    navigate(`/leads?leadId=${leadId}`);
  };

  const handleDownload = async (type: DocumentType, id: string) => {
    try {
      await API_MAP[type].downloadPDF(id);
      toast.success(`${DOWNLOAD_LABEL[type].charAt(0).toUpperCase()}${DOWNLOAD_LABEL[type].slice(1)} PDF downloaded`);
    } catch (error) {
      console.error(`Error downloading ${type} PDF:`, error);
      toast.error(`Failed to download ${DOWNLOAD_LABEL[type]} PDF`);
    }
  };

  const handleSend = async (type: 'quotation' | 'invoice' | 'receipt' | 'voucher', id: string) => {
    try {
      if (type === 'voucher') await voucherAPI.sendEmail(id);
      else await API_MAP[type].send(id);
      toast.success(`${SEND_LABEL[type].charAt(0).toUpperCase()}${SEND_LABEL[type].slice(1)} sent successfully`);
    } catch (error) {
      console.error(`Error sending ${type}:`, error);
      toast.error(`Failed to send ${SEND_LABEL[type]}`);
    }
  };

  const handleDownloadPaymentHistoryList = async () => {
    try {
      const params: Record<string, string> = {};
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;
      await paymentHistoryAPI.downloadListPDF(params);
      toast.success('Payment history list PDF downloaded');
    } catch (error) {
      console.error('Error downloading payment history list PDF:', error);
      toast.error('Failed to download payment history list PDF');
    }
  };

  const handleClearDateFilter = () => {
    setStartDate('');
    setEndDate('');
  };

  const filtered = useMemo(
    () => documents[activeTab].filter((item) => matchesSearch(activeTab, item, searchTerm)),
    [documents, activeTab, searchTerm]
  );

  const currentTab = TAB_META.find((t) => t.id === activeTab)!;

  const totalRevenue = (documents.invoice as Invoice[]).reduce((sum, inv) => sum + (inv.paidAmount || 0), 0);
  const totalOutstanding = (documents.invoice as Invoice[]).reduce((sum, inv) => sum + (inv.outstandingAmount || 0), 0);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- handleDownload/handleSend are stable per render, only activeTab actually varies column shape
  const columns = useMemo<DataTableColumn<BillingDocument>[]>(() => {
    const actionsColumn: DataTableColumn<BillingDocument> = {
      key: 'actions',
      header: 'Actions',
      className: 'text-right',
      render: (item) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <button type="button" className={docActionClass} title="View" onClick={() => setSelected(item)}>
            <Eye className="h-4 w-4" />
          </button>
          <button type="button" className={docActionClass} title="Download" onClick={() => handleDownload(activeTab, item.id)}>
            <Download className="h-4 w-4" />
          </button>
          {activeTab !== 'payment-history' && (
            <button
              type="button"
              className={docActionClass}
              title="Send"
              onClick={() => handleSend(activeTab as 'quotation' | 'invoice' | 'receipt' | 'voucher', item.id)}
            >
              <Send className="h-4 w-4" />
            </button>
          )}
        </div>
      ),
    };

    const customerColumn: DataTableColumn<BillingDocument> = {
      key: 'customer',
      header: 'Customer',
      render: (item) => (
        <div>
          <p className="font-medium text-foreground">{item.customerName || 'N/A'}</p>
          <p className="text-xs text-muted-foreground">{item.customerEmail || ''}</p>
        </div>
      ),
    };

    switch (activeTab) {
      case 'quotation':
        return [
          { key: 'quotationNumber', header: 'Number', className: 'font-mono font-medium text-foreground', render: (item) => (item as Quotation).quotationNumber },
          customerColumn,
          { key: 'issueDate', header: 'Issue Date', numeric: true, render: (item) => formatDate((item as Quotation).issueDate || item.createdAt) },
          { key: 'validUntil', header: 'Valid Until', numeric: true, render: (item) => formatDate((item as Quotation).validUntil) },
          { key: 'totalAmount', header: 'Amount', numeric: true, render: (item) => formatCurrency((item as Quotation).totalAmount) },
          { key: 'status', header: 'Status', render: (item) => <StatusBadge documentType="quotation" status={(item as Quotation).status} /> },
          actionsColumn,
        ];
      case 'invoice':
        return [
          { key: 'invoiceNumber', header: 'Number', className: 'font-mono font-medium text-foreground', render: (item) => (item as Invoice).invoiceNumber },
          customerColumn,
          { key: 'createdAt', header: 'Issue Date', numeric: true, render: (item) => formatDate(item.createdAt) },
          { key: 'dueDate', header: 'Due Date', numeric: true, render: (item) => formatDate((item as Invoice).dueDate) },
          { key: 'totalAmount', header: 'Total', numeric: true, render: (item) => formatCurrency((item as Invoice).totalAmount) },
          { key: 'paidAmount', header: 'Paid', numeric: true, className: 'text-success', render: (item) => formatCurrency((item as Invoice).paidAmount) },
          { key: 'outstandingAmount', header: 'Due', numeric: true, className: 'text-warning', render: (item) => formatCurrency((item as Invoice).outstandingAmount) },
          { key: 'status', header: 'Status', render: (item) => <StatusBadge documentType="invoice" status={(item as Invoice).status} /> },
          actionsColumn,
        ];
      case 'receipt':
        return [
          { key: 'receiptNumber', header: 'Number', className: 'font-mono font-medium text-foreground', render: (item) => (item as Receipt).receiptNumber },
          customerColumn,
          { key: 'paymentDate', header: 'Date', numeric: true, render: (item) => formatDate((item as Receipt).paymentDate) },
          { key: 'paymentMethod', header: 'Method', className: 'capitalize', render: (item) => (item as Receipt).paymentMethod || 'N/A' },
          { key: 'amount', header: 'Amount', numeric: true, render: (item) => formatCurrency((item as Receipt).amount) },
          { key: 'status', header: 'Status', render: (item) => <StatusBadge documentType="receipt" status={(item as Receipt).receiptStatus} /> },
          actionsColumn,
        ];
      case 'voucher':
        return [
          { key: 'voucherNumber', header: 'Number', className: 'font-mono font-medium text-foreground', render: (item) => (item as Voucher).voucherNumber },
          customerColumn,
          { key: 'package', header: 'Package', render: (item) => (item as Voucher).packageDetails?.name || 'N/A' },
          {
            key: 'travelDates',
            header: 'Travel Date',
            render: (item) => `${formatDate((item as Voucher).travelStartDate)} - ${formatDate((item as Voucher).travelEndDate)}`,
          },
          { key: 'status', header: 'Status', render: (item) => <StatusBadge documentType="voucher" status={(item as Voucher).status} /> },
          actionsColumn,
        ];
      case 'payment-history':
        return [
          { key: 'paymentHistoryNumber', header: 'Number', className: 'font-mono font-medium text-foreground', render: (item) => (item as PaymentHistoryRecord).paymentHistoryNumber },
          customerColumn,
          {
            key: 'refs',
            header: 'Receipt / Invoice',
            render: (item) => (
              <div className="flex flex-col font-mono text-xs tabular-nums text-muted-foreground">
                <span>R: {(item as PaymentHistoryRecord).receiptId ? (item as PaymentHistoryRecord).receiptId!.slice(0, 8) : '-'}</span>
                <span>I: {(item as PaymentHistoryRecord).invoiceId ? (item as PaymentHistoryRecord).invoiceId!.slice(0, 8) : '-'}</span>
              </div>
            ),
          },
          { key: 'paymentMethod', header: 'Method', className: 'capitalize', render: (item) => (item as PaymentHistoryRecord).paymentMethod || 'N/A' },
          { key: 'paymentDate', header: 'Date', numeric: true, render: (item) => formatDate((item as PaymentHistoryRecord).paymentDate) },
          { key: 'amount', header: 'Amount', numeric: true, className: 'text-success', render: (item) => formatCurrency((item as PaymentHistoryRecord).amount) },
          { key: 'status', header: 'Status', render: (item) => <StatusBadge documentType="payment-history" status={(item as PaymentHistoryRecord).status} /> },
          actionsColumn,
        ];
    }
  }, [activeTab]);

  return (
      <div className="min-h-screen bg-background">
      <PageHeader
        title="Billing"
        subtitle="Finance management"
        actions={activeTab === 'payment-history' ? (
          <Button onClick={handleDownloadPaymentHistoryList} disabled={loading['payment-history'] || filtered.length === 0}>
            <Download className="h-4 w-4" /> Export All
          </Button>
        ) : undefined}
      />
      <div className="bg-white px-4 pt-4 md:px-6"><RecommendationStrip module="billing" /></div>
      {/* Mobile figures + horizontal tabs. The title row moved into PageHeader,
          so this block is no longer sticky — there is one sticky bar. */}
      <div className="border-b border-border bg-card md:hidden">
        <div className="flex gap-2 px-4 py-2">
          <div className="min-w-0 flex-1 rounded-lg border border-success/20 bg-success/10 px-3 py-1.5">
            <p className="whitespace-nowrap font-mono text-sm font-bold tabular-nums text-success">{formatCurrency(totalRevenue)}</p>
            <p className="text-xs uppercase text-success/70">Revenue</p>
          </div>
          <div className="min-w-0 flex-1 rounded-lg border border-warning/20 bg-warning/10 px-3 py-1.5">
            <p className="whitespace-nowrap font-mono text-sm font-bold tabular-nums text-warning">{formatCurrency(totalOutstanding)}</p>
            <p className="text-xs uppercase text-warning/70">Outstanding</p>
          </div>
        </div>
        <div className="scrollbar-hide overflow-x-auto px-3 pb-3">
          <Tabs value={activeTab} onValueChange={(value) => value && changeTab(value as DocumentType)}>
            <TabsList className="w-max">
              {TAB_META.map((tab) => (
                <TabsTrigger key={tab.id} value={tab.id} className="gap-1.5">
                  <tab.icon className="h-3.5 w-3.5" />
                  {tab.shortLabel}
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs">
                    {idsParam && tab.id !== activeTab ? '—' : documents[tab.id].length}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      </div>

      <div className="flex flex-col md:flex-row">
        {/* Left Sidebar - Desktop only */}
        <aside className="sticky top-0 hidden h-screen w-72 flex-col overflow-y-auto border-r border-border bg-card pb-4 md:flex">
          <div className="border-b border-border p-6">
            <div className="grid grid-cols-1 gap-2">
              <div className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-success/20 bg-success/10 px-3 py-2.5">
                <p className="text-xs font-semibold uppercase tracking-wider text-success/70">Revenue</p>
                <p className="shrink-0 whitespace-nowrap font-mono text-base font-bold tabular-nums text-success">{formatCurrency(totalRevenue)}</p>
              </div>
              <div className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-warning/20 bg-warning/10 px-3 py-2.5">
                <p className="text-xs font-semibold uppercase tracking-wider text-warning/70">Outstanding</p>
                <p className="shrink-0 whitespace-nowrap font-mono text-base font-bold tabular-nums text-warning">{formatCurrency(totalOutstanding)}</p>
              </div>
            </div>
          </div>

          <nav className="flex-1 space-y-1 p-4">
            <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Documents</p>
            {TAB_META.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => changeTab(tab.id)}
                  className={`flex w-full items-center gap-3 rounded-lg p-3 text-left transition-colors ${
                    isActive ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted'
                  }`}
                >
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${isActive ? 'bg-primary-foreground/20' : 'bg-muted'}`}>
                    <tab.icon className={`h-5 w-5 ${isActive ? 'text-primary-foreground' : 'text-muted-foreground'}`} />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{tab.shortLabel}</p>
                    <p className={`text-xs ${isActive ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                      {idsParam && tab.id !== activeTab ? 'Not loaded' : `${documents[tab.id].length} items`}
                    </p>
                  </div>
                </button>
              );
            })}
          </nav>

          <div className="border-t border-border p-4">
            <div className="rounded-lg border border-primary/20 bg-accent p-4">
              <div className="mb-2 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <span className="text-xs font-semibold text-primary">Quick Tip</span>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Click any document to view the linked lead. Use filters to find specific records.
              </p>
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <main className="min-w-0 flex-1">
          <div className="border-b border-border bg-card px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
            {idsParam && (
              <div className="mb-3 flex min-h-11 items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2">
                <p className="text-sm text-foreground">
                  Active filter: linked {currentTab.label.toLowerCase()} <span className="font-mono tabular-nums">({documents[activeTab].length})</span>
                </p>
                <Button variant="ghost" size="xs" onClick={() => setSearchParams({ tab: activeTab })}>
                  Clear filter
                </Button>
              </div>
            )}
            <div className="flex gap-2 sm:gap-3">
              <div className="relative min-w-0 flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder={`Search ${currentTab.label.toLowerCase()}...`}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>

              <Button
                type="button"
                variant={showDateFilter || startDate || endDate ? 'default' : 'outline'}
                size="icon"
                onClick={() => setShowDateFilter(!showDateFilter)}
              >
                <Filter className="h-4 w-4" />
              </Button>

              <div className="hidden gap-1 rounded-lg border border-border bg-card p-1 sm:flex">
                <Button
                  type="button"
                  variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
                  size="icon"
                  onClick={() => setViewMode('grid')}
                  title="Grid View"
                >
                  <LayoutGrid className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant={viewMode === 'table' ? 'secondary' : 'ghost'}
                  size="icon"
                  onClick={() => setViewMode('table')}
                  title="Table View"
                >
                  <TableIcon className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {showDateFilter && (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/50 p-3 sm:mt-4 sm:gap-3 sm:p-4">
                <Calendar className="hidden h-5 w-5 text-muted-foreground sm:block" />
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="flex-1 sm:flex-none" />
                <span className="text-sm text-muted-foreground">to</span>
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="flex-1 sm:flex-none" />
                {(startDate || endDate) && (
                  <Button type="button" variant="ghost" size="sm" onClick={handleClearDateFilter}>
                    Clear
                  </Button>
                )}
              </div>
            )}
          </div>

          <div id="recommendation-target" className="scroll-mt-20 p-4 sm:p-6 lg:p-8">
            {loading[activeTab] ? (
              <LoadingSpinner />
            ) : filtered.length === 0 ? (
              <EmptyState message={`No ${currentTab.label.toLowerCase()} found`} />
            ) : viewMode === 'grid' ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
                {filtered.map((item) => (
                  <DocumentCard
                    key={item.id}
                    documentType={activeTab}
                    typeLabel={currentTab.label.replace(/s$/, '')}
                    documentNumber={getDocumentNumber(activeTab, item)}
                    status={(item as Receipt).receiptStatus ?? (item as { status?: string }).status}
                    customerName={item.customerName}
                    customerEmail={item.customerEmail}
                    amount={getDocumentAmount(activeTab, item)}
                    dateValue={getDocumentDate(activeTab, item)}
                    formatDate={formatDate}
                    leadId={item.leadId}
                    onNavigateToLead={handleNavigateToLead}
                    onView={() => setSelected(item)}
                    onDownload={() => handleDownload(activeTab, item.id)}
                    onSend={activeTab === 'payment-history' ? undefined : () => handleSend(activeTab as 'quotation' | 'invoice' | 'receipt' | 'voucher', item.id)}
                  />
                ))}
              </div>
            ) : (
              <DataTable columns={columns} data={filtered} getRowKey={(item) => item.id} />
            )}
          </div>
        </main>
      </div>

      <DocumentDetailDialog
        documentType={activeTab}
        open={selected !== null}
        onClose={() => setSelected(null)}
        data={selected}
        formatDate={formatDate}
        onDownload={() => selected && handleDownload(activeTab, selected.id)}
        onSend={
          selected && activeTab !== 'payment-history'
            ? () => handleSend(activeTab as 'quotation' | 'invoice' | 'receipt' | 'voucher', selected.id)
            : undefined
        }
      />
      </div>
  );
}
