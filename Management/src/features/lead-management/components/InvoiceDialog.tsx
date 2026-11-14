import { useState, useEffect, useCallback } from 'react';
import {
  FileText, Download, Loader2, Eye,
  Receipt, ScrollText, StickyNote, CheckCircle2, MapPin, Calendar, Plus, Link2, Copy,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import toast from '@/lib/toast';
import { invoiceAPI, quotationAPI, adminAPI } from '../../../services/api';
import PDFPreviewDialog from '@/components/shared/PdfPreview';
import { formatCurrency, LOCALE } from '../../../utils/currency.js';
import { Row } from './shared/BillingPrimitives';
import EditableBulletSection from './shared/EditableBulletSection';
import SendDocumentPanel from './shared/SendDocumentPanel';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { apiErrorMessage } from '@/lib/apiErrorMessage';

const EMPTY_CUSTOMER_OVERRIDES = { customerName: '', customerEmail: '', customerPhone: '', customerAddress: '', customerGstNumber: '', destination: '' };
const emptyFormData = () => ({
  quotation: '', dueDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  bookingId: '', notes: '', paymentTerms: '', paymentInstructions: '',
});

// State-oriented (draft/sent/viewed/paid/partial/overdue/cancelled/refunded)
// - collapsed onto the 5 real semantic tokens rather than 8 raw hues.
const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  sent: 'bg-primary/10 text-primary',
  viewed: 'bg-primary/10 text-primary',
  paid: 'bg-success/10 text-success',
  partial: 'bg-warning/10 text-warning',
  overdue: 'bg-destructive/10 text-destructive',
  cancelled: 'bg-muted text-muted-foreground',
  refunded: 'bg-muted text-muted-foreground',
};

const formatDate = (value: string | null | undefined) => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' });
};

interface Lead {
  id?: string;
  _id?: string;
  name: string;
  email?: string;
  customer?: { email?: string };
  whatsapp?: string;
  phone?: string;
}

interface InvoiceDialogProps {
  isOpen: boolean;
  onClose: () => void;
  lead: Lead | null;
  onSuccess?: () => void;
}

const CUSTOMER_FIELDS: [string, string][] = [
  ['customerName', 'Name'], ['customerEmail', 'Email'], ['customerPhone', 'Phone'],
  ['customerAddress', 'Address'], ['customerGstNumber', 'GST Number'], ['destination', 'Place of Supply'],
];

/**
 * Quotation-derived invoice window. Pricing is never editable here — it's
 * shown verbatim from the selected quotation (create) or the invoice itself
 * (view), matching what quotationAPI.convertToInvoice already enforces
 * server-side. Visually mirrors QuotationModal (flat primary header,
 * single-column cards, channel-tab send).
 */
const InvoiceDialog = ({ isOpen, onClose, lead, onSuccess }: InvoiceDialogProps) => {
  const leadId = lead?.id || lead?._id;

  const [loading, setLoading] = useState(true);
  const [quotations, setQuotations] = useState<any[]>([]);
  const [existingInvoices, setExistingInvoices] = useState<any[]>([]);
  const [orgDefaults, setOrgDefaults] = useState<any>(null);

  const [viewMode, setViewMode] = useState<'create' | 'view'>('create');
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);
  const [quotationSnapshot, setQuotationSnapshot] = useState<any>(null);

  const [formData, setFormData] = useState(emptyFormData());
  const [customerOverrideEnabled, setCustomerOverrideEnabled] = useState(false);
  const [customerOverrides, setCustomerOverrides] = useState<Record<string, string>>(EMPTY_CUSTOMER_OVERRIDES);

  const [creating, setCreating] = useState(false);
  const [sectionSaving, setSectionSaving] = useState<string | null>(null);
  const [channel, setChannel] = useState<'email' | 'whatsapp'>('email');
  const [sendEmail, setSendEmail] = useState('');
  const [sendPhone, setSendPhone] = useState('');
  const [sending, setSending] = useState(false);
  const [creatingPaymentLink, setCreatingPaymentLink] = useState(false);
  const [paymentLinkUrl, setPaymentLinkUrl] = useState('');
  const [showPDFPreview, setShowPDFPreview] = useState(false);

  const invoiceId = selectedInvoice?.id || selectedInvoice?._id || null;

  const loadQuotationData = useCallback(async (quotationId: string) => {
    if (!quotationId) { setQuotationSnapshot(null); return; }
    try {
      const response = await quotationAPI.getById(quotationId);
      const quote = response.data || response;
      const snapshot = {
        packageTitle: quote.packageTitle, quotationNumber: quote.quotationNumber,
        customerName: quote.customerName || '', customerEmail: quote.customerEmail || '',
        customerPhone: quote.customerPhone || '', customerAddress: quote.customerAddress || '',
        customerGstNumber: quote.customerGstNumber || '', destination: quote.destination || '',
        subtotal: quote.subtotal || 0, discountAmount: quote.discountAmount || 0,
        taxAmount: quote.taxAmount || 0, taxRate: quote.taxRate || 0,
        serviceChargeAmount: quote.serviceChargeAmount || 0, serviceChargeRate: quote.serviceChargeRate || 0,
        totalAmount: quote.totalAmount || 0, items: quote.items || [], notes: quote.notes || '',
      };
      setQuotationSnapshot(snapshot);
      setCustomerOverrideEnabled(false);
      setCustomerOverrides({
        customerName: snapshot.customerName, customerEmail: snapshot.customerEmail,
        customerPhone: snapshot.customerPhone, customerAddress: snapshot.customerAddress,
        customerGstNumber: snapshot.customerGstNumber, destination: snapshot.destination,
      });
      setFormData((prev) => ({ ...prev, quotation: quotationId, notes: prev.notes || snapshot.notes }));
    } catch (err: any) {
      toast.error(apiErrorMessage(err));
    }
  }, []);

  const initialize = useCallback(async () => {
    if (!leadId) return;
    setLoading(true);
    setViewMode('create');
    setSelectedInvoice(null);
    setPaymentLinkUrl('');
    setQuotationSnapshot(null);
    setFormData(emptyFormData());
    setCustomerOverrideEnabled(false);
    setChannel('email');
    setSendEmail(lead?.email || lead?.customer?.email || '');
    setSendPhone(lead?.whatsapp || lead?.phone || '');

    try {
      const [quoteRes, invoiceRes, brandingRes] = await Promise.all([
        quotationAPI.getByLead(leadId),
        invoiceAPI.getByLead(leadId),
        adminAPI.getOrganizationBranding().catch(() => null),
      ]);

      const quoteList = (quoteRes.data?.quotations || quoteRes.data || []).filter((q: any) => q.status !== 'converted');
      setQuotations(quoteList);

      const invoiceData = invoiceRes.data?.invoices || invoiceRes.data?.data || invoiceRes.data || [];
      const invoiceList = Array.isArray(invoiceData) ? invoiceData : [];
      setExistingInvoices(invoiceList);

      const branding = brandingRes?.data?.branding || null;
      setOrgDefaults(branding);

      if (invoiceList.length > 0) {
        setViewMode('view');
        setSelectedInvoice(invoiceList[0]);
      } else {
        setViewMode('create');
        if (quoteList.length > 0) {
          const latest = quoteList[0];
          const latestId = latest._id || latest.id;
          await loadQuotationData(latestId);
        }
        setFormData((prev) => ({
          ...prev,
          paymentTerms: prev.paymentTerms || branding?.invoicePaymentTerms || '',
          paymentInstructions: prev.paymentInstructions || branding?.invoicePaymentInstructions || '',
        }));
      }
    } catch (err: any) {
      toast.error(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [leadId, lead, loadQuotationData]);

  useEffect(() => {
    if (isOpen && leadId) initialize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, leadId, initialize]);

  const startNewInvoice = () => {
    setViewMode('create');
    setSelectedInvoice(null);
    setFormData({ ...emptyFormData(), paymentTerms: orgDefaults?.invoicePaymentTerms || '', paymentInstructions: orgDefaults?.invoicePaymentInstructions || '' });
    setCustomerOverrideEnabled(false);
    if (quotations.length > 0) {
      const latest = quotations[0];
      loadQuotationData(latest._id || latest.id);
    } else {
      setQuotationSnapshot(null);
    }
  };

  const viewInvoice = (inv: any) => {
    setViewMode('view');
    setSelectedInvoice(inv);
    setPaymentLinkUrl('');
    setChannel('email');
    setSendEmail(inv.customerEmail || lead?.email || '');
    setSendPhone(inv.customerPhone || lead?.whatsapp || lead?.phone || '');
  };

  const handleQuotationSelect = (quotationId: string) => {
    setFormData((prev) => ({ ...prev, quotation: quotationId }));
    if (quotationId) loadQuotationData(quotationId); else setQuotationSnapshot(null);
  };

  const toggleCustomerOverride = () => {
    setCustomerOverrideEnabled((prev) => {
      const next = !prev;
      if (!next && quotationSnapshot) {
        setCustomerOverrides({
          customerName: quotationSnapshot.customerName, customerEmail: quotationSnapshot.customerEmail,
          customerPhone: quotationSnapshot.customerPhone, customerAddress: quotationSnapshot.customerAddress,
          customerGstNumber: quotationSnapshot.customerGstNumber, destination: quotationSnapshot.destination,
        });
      }
      return next;
    });
  };

  const handleDownloadQuotationPDF = async () => {
    if (!formData.quotation) return;
    try { await quotationAPI.downloadPDF(formData.quotation); toast.success('Quotation PDF downloaded'); }
    catch { toast.error('Failed to download quotation PDF'); }
  };

  const showOrgSettingsErrorToast = (message: string) => {
    if (/organization settings/i.test(message)) {
      toast.error((t) => (
        <div className="text-sm">
          <p className="mb-1.5">{message}</p>
          <a href="/settings" className="font-semibold text-primary underline" onClick={() => toast.dismiss(t.id)}>
            Open Organization Settings →
          </a>
        </div>
      ), { duration: 9000 });
    } else {
      toast.error(message);
    }
  };

  const handleCreateFromQuotation = async () => {
    if (!formData.quotation) { toast.error('Please select a quotation'); return; }
    const overrides: Record<string, any> = {};
    if (formData.dueDate) overrides.dueDate = new Date(formData.dueDate).toISOString();
    if (formData.bookingId?.trim()) overrides.bookingId = formData.bookingId.trim();
    if (formData.notes?.trim()) overrides.notes = formData.notes.trim();
    if (formData.paymentTerms?.trim()) overrides.paymentTerms = formData.paymentTerms.trim();
    if (formData.paymentInstructions?.trim()) overrides.paymentInstructions = formData.paymentInstructions.trim();
    if (customerOverrideEnabled) {
      for (const field of ['customerName', 'customerEmail', 'customerPhone', 'customerAddress', 'customerGstNumber', 'destination']) {
        const value = customerOverrides[field]?.trim();
        if (value) overrides[field] = value;
      }
    }

    try {
      setCreating(true);
      const response = await quotationAPI.convertToInvoice(formData.quotation, overrides);
      const created = response.data;
      toast.success('Invoice created from quotation');
      setExistingInvoices((prev) => [created, ...prev]);
      viewInvoice(created);
      setShowPDFPreview(true);
      onSuccess?.();
    } catch (err: any) {
      showOrgSettingsErrorToast(err.message || 'Failed to create invoice');
    } finally {
      setCreating(false);
    }
  };

  const handleSectionSave = async (field: string, value: string) => {
    if (viewMode === 'view' && invoiceId) {
      setSectionSaving(field);
      try {
        const response = await invoiceAPI.update(invoiceId, { [field]: value });
        const updated = response.data;
        setSelectedInvoice(updated);
        setExistingInvoices((prev) => prev.map((inv) => ((inv.id || inv._id) === invoiceId ? updated : inv)));
        toast.success('Invoice updated');
      } catch (err: any) {
        toast.error(apiErrorMessage(err));
        throw err;
      } finally {
        setSectionSaving(null);
      }
    } else {
      setFormData((prev) => ({ ...prev, [field]: value }));
    }
  };

  const handleSend = async () => {
    if (!invoiceId) return;
    const recipient = channel === 'email' ? sendEmail.trim() : sendPhone.trim();
    if (!recipient) { toast.error(channel === 'email' ? 'Enter a recipient email' : 'Enter a WhatsApp number'); return; }
    setSending(true);
    try {
      const payload = channel === 'email' ? { channel, email: recipient } : { channel, phone: recipient };
      const response = await invoiceAPI.send(invoiceId, payload);
      const updated = response.data;
      if (updated) {
        setSelectedInvoice(updated);
        setExistingInvoices((prev) => prev.map((inv) => ((inv.id || inv._id) === invoiceId ? updated : inv)));
      }
      if (response.warning) toast.error(response.warning);
      else toast.success(channel === 'email' ? 'Invoice emailed' : 'Invoice sent via WhatsApp');
      onSuccess?.();
    } catch (err: any) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const handleCreatePaymentLink = async () => {
    if (!invoiceId) return;
    setCreatingPaymentLink(true);
    try {
      const response = await invoiceAPI.createPaymentLink(invoiceId);
      const url = response.data?.url;
      if (typeof url !== 'string') throw new Error('Stripe did not return a payment link.');
      setPaymentLinkUrl(url);
      try {
        await navigator.clipboard.writeText(url);
        toast.success('Stripe payment link copied');
      } catch {
        toast.error('Payment link is ready below; copy it to share with the customer.');
      }
    } catch (err: any) {
      toast.error(apiErrorMessage(err));
    } finally {
      setCreatingPaymentLink(false);
    }
  };

  const handleCopyPaymentLink = async () => {
    if (!paymentLinkUrl) return;
    try {
      await navigator.clipboard.writeText(paymentLinkUrl);
      toast.success('Stripe payment link copied');
    } catch {
      toast.error('Could not access the clipboard. Select and copy the link below.');
    }
  };

  if (!lead) return null;

  const totals = viewMode === 'create'
    ? quotationSnapshot
    : selectedInvoice && {
      subtotal: selectedInvoice.subtotal, discountAmount: selectedInvoice.discountAmount,
      taxAmount: selectedInvoice.taxAmount, taxRate: selectedInvoice.taxRate,
      serviceChargeAmount: selectedInvoice.serviceChargeAmount, totalAmount: selectedInvoice.totalAmount,
      items: selectedInvoice.items,
    };

  const displayCustomer = viewMode === 'create' ? quotationSnapshot : selectedInvoice;
  const tripMeta: { icon: LucideIcon; text: string }[] = [
    displayCustomer?.destination ? { icon: MapPin, text: displayCustomer.destination } : null,
    (viewMode === 'view' && selectedInvoice?.dueDate) ? { icon: Calendar, text: `Due ${formatDate(selectedInvoice.dueDate)}` } : null,
  ].filter(Boolean) as { icon: LucideIcon; text: string }[];

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
        <DialogContent
          className="sm:max-w-3xl max-h-[92vh] p-0 gap-0 overflow-hidden flex flex-col"
          closeClassName="text-primary-foreground hover:bg-primary-foreground/20 hover:text-primary-foreground dark:hover:bg-primary-foreground/20 dark:hover:text-primary-foreground"
        >
          <DialogHeader className="bg-primary text-primary-foreground px-6 py-4 space-y-0">
            <div className="flex items-center gap-3 min-w-0">
              <div className="rounded-lg bg-primary-foreground/20 p-2 shrink-0"><Receipt className="h-5 w-5" /></div>
              <div className="min-w-0">
                <DialogTitle className="text-primary-foreground truncate">
                  {viewMode === 'view' && selectedInvoice ? selectedInvoice.invoiceNumber : 'New Invoice'}
                </DialogTitle>
                <DialogDescription className="text-primary-foreground/80 truncate">{lead.name}</DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {loading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…
              </div>
            ) : (
              <>
                {/* Previous invoices pill row */}
                {existingInvoices.length > 0 && (
                  <div className="mb-5">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Invoices for this lead</p>
                    <div className="flex flex-wrap gap-2">
                      {existingInvoices.map((inv) => {
                        const id = inv.id || inv._id;
                        const isActive = viewMode === 'view' && invoiceId === id;
                        return (
                          <button
                            key={id}
                            onClick={() => viewInvoice(inv)}
                            className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition ${
                              isActive ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground hover:border-ring'
                            }`}
                          >
                            <FileText className="h-4 w-4" />
                            {inv.invoiceNumber}
                            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold uppercase ${STATUS_STYLES[inv.status] || 'bg-muted text-muted-foreground'}`}>
                              {inv.status}
                            </span>
                          </button>
                        );
                      })}
                      <button
                        onClick={startNewInvoice}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition ${
                          viewMode === 'create' ? 'border-primary bg-primary/10 text-primary' : 'border-dashed border-border text-muted-foreground hover:border-ring'
                        }`}
                      >
                        <Plus className="h-4 w-4" /> New from quotation
                      </button>
                    </div>
                  </div>
                )}

                {viewMode === 'create' && (
                  <div className="mb-5 rounded-xl border border-border p-5">
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Select Quotation</label>
                    {quotations.length === 0 ? (
                      <p className="text-sm text-warning">No quotations available for this lead yet.</p>
                    ) : (
                      <div className="flex gap-3">
                        <Select value={formData.quotation} onValueChange={(value) => handleQuotationSelect(String(value))}>
                          <SelectTrigger className="flex-1">
                            <SelectValue placeholder="— Select Quotation —">
                              {(value: string) => {
                                const match = quotations.find((item) => (item._id || item.id) === value);
                                return match ? `${match.packageTitle || 'Package'} — ${match.quotationNumber || match._id}` : value;
                              }}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {quotations.map((q) => (
                              <SelectItem key={q._id || q.id} value={q._id || q.id}>{q.packageTitle || 'Package'} — {q.quotationNumber || q._id}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {formData.quotation && (
                          <Button type="button" variant="outline" size="icon" onClick={handleDownloadQuotationPDF} aria-label="Download quotation PDF">
                            <Download className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {(viewMode === 'create' ? quotationSnapshot : selectedInvoice) && (
                  <div className="space-y-5">
                    {/* Summary card */}
                    <div className="rounded-xl border border-border p-5">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <h3 className="text-base font-semibold text-foreground">
                            {viewMode === 'create' ? (quotationSnapshot.packageTitle || 'Package') : 'Invoice Summary'}
                          </h3>
                          {tripMeta.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                              {tripMeta.map((m, i) => (
                                <span key={i} className="inline-flex items-center gap-1.5"><m.icon className="h-3.5 w-3.5" />{m.text}</span>
                              ))}
                            </div>
                          )}
                        </div>
                        {viewMode === 'view' && selectedInvoice?.emailSent && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-3 py-1 text-xs font-medium text-success">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Sent
                          </span>
                        )}
                      </div>

                      {/* Tax breakdown */}
                      {totals && (
                        <div className="mt-4 border-t border-border pt-4">
                          <dl className="space-y-1.5 text-sm">
                            <Row label="Subtotal" value={formatCurrency(totals.subtotal, { minimumFractionDigits: 2 })} />
                            {totals.discountAmount > 0 && <Row label="Discount" value={`- ${formatCurrency(totals.discountAmount, { minimumFractionDigits: 2 })}`} />}
                            {totals.taxAmount > 0 && <Row label={`Tax${totals.taxRate ? ` (${totals.taxRate}%)` : ''}`} value={formatCurrency(totals.taxAmount, { minimumFractionDigits: 2 })} />}
                            {totals.serviceChargeAmount > 0 && <Row label="Service charge" value={formatCurrency(totals.serviceChargeAmount, { minimumFractionDigits: 2 })} />}
                            <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
                              <span className="text-base font-semibold text-foreground">Total</span>
                              <span className="text-lg font-bold text-primary">{formatCurrency(totals.totalAmount, { minimumFractionDigits: 2 })}</span>
                            </div>
                          </dl>
                        </div>
                      )}
                    </div>

                    {/* Due date / booking id — only meaningful while creating */}
                    {viewMode === 'create' && (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="rounded-xl border border-border p-4">
                          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Due Date</label>
                          <input type="date" value={formData.dueDate} onChange={(e) => setFormData((f) => ({ ...f, dueDate: e.target.value }))} className="w-full text-sm font-medium text-foreground bg-transparent focus:outline-none" />
                        </div>
                        <div className="rounded-xl border border-border p-4">
                          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Booking Id (optional)</label>
                          <input type="text" value={formData.bookingId} onChange={(e) => setFormData((f) => ({ ...f, bookingId: e.target.value }))} placeholder="—" className="w-full text-sm font-medium text-foreground bg-transparent focus:outline-none placeholder:text-muted-foreground/50" />
                        </div>
                      </div>
                    )}

                    {/* Customer details — only editable/overridable during creation */}
                    {viewMode === 'create' && quotationSnapshot && (
                      <div className="rounded-xl border border-border p-5">
                        <div className="mb-3 flex items-center justify-between">
                          <p className="text-sm font-semibold text-foreground">Customer Details</p>
                          <button type="button" onClick={toggleCustomerOverride} className="text-xs font-semibold text-primary hover:text-primary/80">
                            {customerOverrideEnabled ? '↺ Use quotation details' : '✎ Override for this invoice'}
                          </button>
                        </div>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          {CUSTOMER_FIELDS.map(([field, label]) => (
                            <div key={field}>
                              <label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
                              {customerOverrideEnabled ? (
                                <Input type="text" value={customerOverrides[field]} onChange={(e) => setCustomerOverrides((prev) => ({ ...prev, [field]: e.target.value }))} />
                              ) : (
                                <p className="rounded-lg bg-muted px-3 py-2 text-sm text-foreground">{quotationSnapshot[field] || '—'}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {viewMode === 'view' && selectedInvoice && (
                      <div className="rounded-xl border border-border p-5">
                        <p className="mb-3 text-sm font-semibold text-foreground">Customer Details</p>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          {CUSTOMER_FIELDS.map(([field, label]) => (
                            <div key={field}>
                              <label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
                              <p className="rounded-lg bg-muted px-3 py-2 text-sm text-foreground">{selectedInvoice[field] || '—'}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Point-form terms — load default, edit, Save/Cancel per section */}
                    <EditableBulletSection
                      icon={ScrollText}
                      title="Payment Terms"
                      subtitle="Shown on the invoice PDF as bullet points"
                      mode="bullets"
                      value={viewMode === 'view' ? (selectedInvoice?.paymentTerms || '') : formData.paymentTerms}
                      onSave={(v) => handleSectionSave('paymentTerms', v)}
                      saving={sectionSaving === 'paymentTerms'}
                    />
                    <EditableBulletSection
                      icon={ScrollText}
                      title="Payment Instructions"
                      subtitle="Shown below the bank details on the invoice PDF"
                      mode="bullets"
                      value={viewMode === 'view' ? (selectedInvoice?.paymentInstructions || '') : formData.paymentInstructions}
                      onSave={(v) => handleSectionSave('paymentInstructions', v)}
                      saving={sectionSaving === 'paymentInstructions'}
                    />
                    <EditableBulletSection
                      icon={StickyNote}
                      title="Notes"
                      subtitle="Internal — not shown on the invoice PDF"
                      mode="text"
                      value={viewMode === 'view' ? (selectedInvoice?.notes || '') : formData.notes}
                      onSave={(v) => handleSectionSave('notes', v)}
                      saving={sectionSaving === 'notes'}
                    />

                    {viewMode === 'create' ? (
                      <Button onClick={handleCreateFromQuotation} disabled={creating || !formData.quotation} className="w-full">
                        {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                        {creating ? 'Creating…' : 'Create Invoice'}
                      </Button>
                    ) : (
                      <>
                        {/* Delivery */}
                        <SendDocumentPanel
                          channel={channel}
                          onChannelChange={setChannel}
                          email={sendEmail}
                          onEmailChange={setSendEmail}
                          phone={sendPhone}
                          onPhoneChange={setSendPhone}
                          onSend={handleSend}
                          sending={sending}
                        />

                        {selectedInvoice.status !== 'draft' &&
                          selectedInvoice.status !== 'cancelled' &&
                          Number(selectedInvoice.outstandingAmount) > 0 && (
                            <div className="space-y-2 rounded-xl border border-border p-4">
                              <Button
                                type="button"
                                variant="outline"
                                onClick={handleCreatePaymentLink}
                                disabled={creatingPaymentLink}
                                className="w-full"
                              >
                                {creatingPaymentLink ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                                {creatingPaymentLink ? 'Creating link…' : 'Create Stripe payment link'}
                              </Button>
                              {paymentLinkUrl && (
                                <div className="flex gap-2">
                                  <Input aria-label="Stripe payment link" readOnly value={paymentLinkUrl} />
                                  <Button type="button" variant="outline" onClick={handleCopyPaymentLink} aria-label="Copy Stripe payment link">
                                    <Copy className="h-4 w-4" />
                                  </Button>
                                </div>
                              )}
                            </div>
                          )}

                        <Button variant="outline" onClick={() => setShowPDFPreview(true)} className="w-full">
                          <Eye className="h-4 w-4" /> Preview PDF
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          <DialogFooter showCloseButton className="-mx-0 -mb-0" />
        </DialogContent>
      </Dialog>

      {showPDFPreview && invoiceId && (
        <PDFPreviewDialog
          isOpen={showPDFPreview}
          onClose={() => setShowPDFPreview(false)}
          pdfUrl={`/billing/invoices/${invoiceId}/pdf`}
          documentName="Invoice"
          onDownload
        />
      )}
    </>
  );
};

export default InvoiceDialog;
