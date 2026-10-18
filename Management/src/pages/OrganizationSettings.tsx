import { useEffect, useState, type ChangeEvent, type ReactNode } from 'react';
import { Save, Upload, Loader2 } from 'lucide-react';
import toast from '@/lib/toast';
import { adminAPI, uploadAPI } from '../services/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';

import PageHeader from '../components/PageHeader';

interface SettingsForm {
  companyName: string;
  companyShortName: string;
  companyLegalName: string;
  companyAddress: string;
  companyGstNumber: string;
  tagline: string;
  logoUrl: string;
  contactEmail: string;
  salesEmail: string;
  supportEmail: string;
  contactPhone: string;
  whatsappNumber: string;
  website: string;
  themeInk: string;
  themeMuted: string;
  themeAccent: string;
  themeAccentDark: string;
  defaultCurrency: string;
  defaultTaxRate: string;
  defaultServiceChargeRate: string;
  quotationValidityDays: string;
  quotationTerms: string;
  cancellationPolicy: string;
  invoicePaymentTerms: string;
  invoicePaymentInstructions: string;
  ratingTagline: string;
  paymentMethods: string;
  docPrefixQuotation: string;
  docPrefixInvoice: string;
  docPrefixReceipt: string;
  docPrefixPayment: string;
  docPrefixCreditNote: string;
  docPrefixVoucher: string;
  bankName: string;
  bankAccountName: string;
  bankAccountNumber: string;
  bankIfscCode: string;
  bankSwiftCode: string;
  bankBranch: string;
  bankAccountType: string;
  upiId: string;
}

const EMPTY_FORM: SettingsForm = {
  companyName: '', companyShortName: '', companyLegalName: '', companyAddress: '', companyGstNumber: '', tagline: '', logoUrl: '',
  contactEmail: '', salesEmail: '', supportEmail: '', contactPhone: '', whatsappNumber: '', website: '',
  themeInk: '', themeMuted: '', themeAccent: '', themeAccentDark: '',
  defaultCurrency: '', defaultTaxRate: '', defaultServiceChargeRate: '', quotationValidityDays: '',
  quotationTerms: '', cancellationPolicy: '', invoicePaymentTerms: '', invoicePaymentInstructions: '', ratingTagline: '',
  paymentMethods: '',
  docPrefixQuotation: '', docPrefixInvoice: '', docPrefixReceipt: '',
  docPrefixPayment: '', docPrefixCreditNote: '', docPrefixVoucher: '',
  bankName: '', bankAccountName: '', bankAccountNumber: '', bankIfscCode: '',
  bankSwiftCode: '', bankBranch: '', bankAccountType: '', upiId: '',
};

const NULLABLE_FIELDS: (keyof SettingsForm)[] = [
  'companyShortName', 'companyLegalName', 'companyAddress', 'companyGstNumber', 'tagline', 'logoUrl',
  'contactEmail', 'salesEmail', 'supportEmail', 'contactPhone', 'whatsappNumber', 'website',
  'themeInk', 'themeMuted', 'themeAccent', 'themeAccentDark',
  'quotationTerms', 'cancellationPolicy', 'invoicePaymentTerms', 'invoicePaymentInstructions', 'ratingTagline',
  'bankName', 'bankAccountName', 'bankAccountNumber', 'bankIfscCode',
  'bankSwiftCode', 'bankBranch', 'bankAccountType', 'upiId',
];

const settingsToForm = (settings: Record<string, any>): SettingsForm => ({
  companyName: settings.companyName ?? '',
  companyShortName: settings.companyShortName ?? '',
  companyLegalName: settings.companyLegalName ?? '',
  companyAddress: settings.companyAddress ?? '',
  companyGstNumber: settings.companyGstNumber ?? '',
  tagline: settings.tagline ?? '',
  logoUrl: settings.logoUrl ?? '',
  contactEmail: settings.contactEmail ?? '',
  salesEmail: settings.salesEmail ?? '',
  supportEmail: settings.supportEmail ?? '',
  contactPhone: settings.contactPhone ?? '',
  whatsappNumber: settings.whatsappNumber ?? '',
  website: settings.website ?? '',
  themeInk: settings.themeInk ?? '',
  themeMuted: settings.themeMuted ?? '',
  themeAccent: settings.themeAccent ?? '',
  themeAccentDark: settings.themeAccentDark ?? '',
  defaultCurrency: settings.defaultCurrency ?? '',
  defaultTaxRate: settings.defaultTaxRate ?? '',
  defaultServiceChargeRate: settings.defaultServiceChargeRate ?? '',
  quotationValidityDays: settings.quotationValidityDays ?? '',
  quotationTerms: settings.quotationTerms ?? '',
  cancellationPolicy: settings.cancellationPolicy ?? '',
  invoicePaymentTerms: settings.invoicePaymentTerms ?? '',
  invoicePaymentInstructions: settings.invoicePaymentInstructions ?? '',
  ratingTagline: settings.ratingTagline ?? '',
  paymentMethods: (settings.paymentMethods || []).join(', '),
  docPrefixQuotation: settings.docNumberPrefixes?.quotation ?? '',
  docPrefixInvoice: settings.docNumberPrefixes?.invoice ?? '',
  docPrefixReceipt: settings.docNumberPrefixes?.receipt ?? '',
  docPrefixPayment: settings.docNumberPrefixes?.payment ?? '',
  docPrefixCreditNote: settings.docNumberPrefixes?.creditNote ?? '',
  docPrefixVoucher: settings.docNumberPrefixes?.voucher ?? '',
  bankName: settings.bankName ?? '',
  bankAccountName: settings.bankAccountName ?? '',
  bankAccountNumber: settings.bankAccountNumber ?? '',
  bankIfscCode: settings.bankIfscCode ?? '',
  bankSwiftCode: settings.bankSwiftCode ?? '',
  bankBranch: settings.bankBranch ?? '',
  bankAccountType: settings.bankAccountType ?? '',
  upiId: settings.upiId ?? '',
});

const formToPayload = (form: SettingsForm) => {
  const payload: Record<string, any> = { companyName: form.companyName };
  for (const field of NULLABLE_FIELDS) {
    payload[field] = form[field].trim() === '' ? null : form[field];
  }
  payload.defaultCurrency = form.defaultCurrency.trim().toUpperCase() || 'USD';
  payload.defaultTaxRate = form.defaultTaxRate === '' ? null : Number(form.defaultTaxRate);
  payload.defaultServiceChargeRate =
    form.defaultServiceChargeRate === '' ? null : Number(form.defaultServiceChargeRate);
  payload.quotationValidityDays =
    form.quotationValidityDays === '' ? 30 : Number(form.quotationValidityDays);
  payload.paymentMethods = form.paymentMethods
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  payload.docNumberPrefixes = {
    quotation: form.docPrefixQuotation.trim() || undefined,
    invoice: form.docPrefixInvoice.trim() || undefined,
    receipt: form.docPrefixReceipt.trim() || undefined,
    payment: form.docPrefixPayment.trim() || undefined,
    creditNote: form.docPrefixCreditNote.trim() || undefined,
    voucher: form.docPrefixVoucher.trim() || undefined,
  };
  return payload;
};

interface FieldProps extends React.ComponentProps<typeof Input> {
  label: string;
  helperText?: string;
}

function Field({ label, helperText, ...props }: FieldProps) {
  return (
    <div>
      <label className="block text-sm font-medium text-foreground mb-1.5">{label}</label>
      <Input {...props} className="h-9" />
      {helperText && <p className="text-xs text-muted-foreground mt-1">{helperText}</p>}
    </div>
  );
}

interface TextAreaFieldProps extends React.ComponentProps<typeof Textarea> {
  label: string;
  helperText?: string;
}

function TextAreaField({ label, helperText, ...props }: TextAreaFieldProps) {
  return (
    <div>
      <label className="block text-sm font-medium text-foreground mb-1.5">{label}</label>
      <Textarea {...props} rows={4} />
      {helperText && <p className="text-xs text-muted-foreground mt-1">{helperText}</p>}
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{children}</div>
      </CardContent>
    </Card>
  );
}

const OrganizationSettings = () => {
  const [form, setForm] = useState<SettingsForm>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const response = await adminAPI.getSettings();
        if (response.status === 'success' && response.data?.settings) {
          setForm(settingsToForm(response.data.settings));
        }
      } catch (err) {
        toast.error((err as Error)?.message || 'Failed to load organization settings');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const set = (field: keyof SettingsForm) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleLogoUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingLogo(true);
    try {
      const response = await uploadAPI.uploadSingle(file);
      if (response.success && response.data?.url) {
        setForm((f) => ({ ...f, logoUrl: response.data.url }));
        toast.success('Logo uploaded');
      } else {
        toast.error(response.message || 'Logo upload failed');
      }
    } catch (err) {
      toast.error((err as Error)?.message || 'Logo upload failed');
    } finally {
      setUploadingLogo(false);
      e.target.value = '';
    }
  };

  const handleSave = async () => {
    if (!form.companyName.trim()) {
      toast.error('Company name is required');
      return;
    }
    setSaving(true);
    try {
      const response = await adminAPI.updateSettings(formToPayload(form));
      if (response.status === 'success' && response.data?.settings) {
        setForm(settingsToForm(response.data.settings));
        toast.success('Organization settings saved');
      } else {
        toast.error(response.message || 'Failed to save settings');
      }
    } catch (err) {
      toast.error((err as Error)?.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 text-muted-foreground animate-spin" />
      </div>
    );
  }

  return (
      <div className="h-full overflow-auto bg-background">
      <PageHeader
        title="Organization Settings"
        subtitle="Company identity, branding, and quotation defaults used across the CRM"
        actions={
          <Button onClick={handleSave} disabled={saving} className="gap-2 h-9">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        }
      />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6">

        <Section
          title="Company Identity"
          description="Shown on quotations, invoices, and the Management sidebar"
        >
          <Field label="Company Name" required value={form.companyName} onChange={set('companyName')} />
          <Field label="Short Name" value={form.companyShortName} onChange={set('companyShortName')} />
          <Field label="Legal Name" value={form.companyLegalName} onChange={set('companyLegalName')} />
          <Field label="Tagline" value={form.tagline} onChange={set('tagline')} />
          <Field
            label="GST Number"
            value={form.companyGstNumber}
            onChange={set('companyGstNumber')}
            helperText="Shown on invoice PDFs as the 'Bill From' GST No"
          />
          <Field
            label="Address"
            value={form.companyAddress}
            onChange={set('companyAddress')}
            helperText="Shown on invoice PDFs as the 'Bill From' address"
          />
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-foreground mb-1.5">Logo</label>
            <div className="flex items-center gap-3">
              {form.logoUrl && (
                <img
                  src={form.logoUrl}
                  alt="Logo preview"
                  className="h-10 w-auto rounded border border-border"
                />
              )}
              <label className="flex items-center gap-2 px-3 py-2 text-sm border border-border rounded-lg cursor-pointer hover:bg-muted transition-colors">
                {uploadingLogo ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4" />
                )}
                {uploadingLogo ? 'Uploading...' : 'Upload logo'}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleLogoUpload}
                  disabled={uploadingLogo}
                />
              </label>
            </div>
          </div>
        </Section>

        <Section title="Contact & Web">
          <Field label="Contact Email" type="email" value={form.contactEmail} onChange={set('contactEmail')} />
          <Field label="Sales Email" type="email" value={form.salesEmail} onChange={set('salesEmail')} />
          <Field label="Support Email" type="email" value={form.supportEmail} onChange={set('supportEmail')} />
          <Field label="Phone" value={form.contactPhone} onChange={set('contactPhone')} />
          <Field label="WhatsApp Number" value={form.whatsappNumber} onChange={set('whatsappNumber')} />
          <Field label="Website" value={form.website} onChange={set('website')} />
        </Section>

        <Section title="Quotation PDF Theme" description="Colors used on generated quotation and invoice PDFs">
          <Field label="Ink (text)" type="color" value={form.themeInk || '#1F2937'} onChange={set('themeInk')} />
          <Field label="Muted text" type="color" value={form.themeMuted || '#64748B'} onChange={set('themeMuted')} />
          <Field label="Accent" type="color" value={form.themeAccent || '#F5A623'} onChange={set('themeAccent')} />
          <Field
            label="Accent (dark)"
            type="color"
            value={form.themeAccentDark || '#D98A0B'}
            onChange={set('themeAccentDark')}
          />
        </Section>

        <Section title="Quotation Defaults" description="Used whenever a quotation doesn't specify its own values">
          <Field
            label="Default Currency"
            maxLength={3}
            value={form.defaultCurrency}
            onChange={set('defaultCurrency')}
            helperText="3-letter code, e.g. USD"
          />
          <Field
            label="Validity (days)"
            type="number"
            min="1"
            value={form.quotationValidityDays}
            onChange={set('quotationValidityDays')}
          />
          <Field
            label="Default Tax Rate (%)"
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={form.defaultTaxRate}
            onChange={set('defaultTaxRate')}
          />
          <Field
            label="Default Service Charge Rate (%)"
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={form.defaultServiceChargeRate}
            onChange={set('defaultServiceChargeRate')}
          />
          <Field
            label="Rating Tagline"
            value={form.ratingTagline}
            onChange={set('ratingTagline')}
            helperText="Shown in the PDF footer band"
          />
          <Field
            label="Payment Methods"
            value={form.paymentMethods}
            onChange={set('paymentMethods')}
            helperText="Comma-separated, e.g. Bank Transfer, UPI, Visa"
          />
          <div className="sm:col-span-2">
            <TextAreaField
              label="Terms & Conditions"
              value={form.quotationTerms}
              onChange={set('quotationTerms')}
            />
          </div>
          <div className="sm:col-span-2">
            <TextAreaField
              label="Cancellation Policy"
              value={form.cancellationPolicy}
              onChange={set('cancellationPolicy')}
            />
          </div>
        </Section>

        <Section
          title="Document Number Prefixes"
          description="Leave blank to keep the default prefix for that document type"
        >
          <Field label="Quotation" placeholder="QUO" value={form.docPrefixQuotation} onChange={set('docPrefixQuotation')} />
          <Field label="Invoice" placeholder="INV" value={form.docPrefixInvoice} onChange={set('docPrefixInvoice')} />
          <Field label="Receipt" placeholder="REC" value={form.docPrefixReceipt} onChange={set('docPrefixReceipt')} />
          <Field label="Payment" placeholder="PAY" value={form.docPrefixPayment} onChange={set('docPrefixPayment')} />
          <Field label="Credit Note" placeholder="CN" value={form.docPrefixCreditNote} onChange={set('docPrefixCreditNote')} />
          <Field label="Voucher" placeholder="VOU" value={form.docPrefixVoucher} onChange={set('docPrefixVoucher')} />
        </Section>

        <Section
          title="Bank & Payment Details"
          description="Shown on quotation PDFs when configured - visible to customers"
        >
          <Field label="Bank Name" value={form.bankName} onChange={set('bankName')} />
          <Field label="Account Name" value={form.bankAccountName} onChange={set('bankAccountName')} />
          <Field label="Account Number" value={form.bankAccountNumber} onChange={set('bankAccountNumber')} />
          <Field label="Account Type" value={form.bankAccountType} onChange={set('bankAccountType')} />
          <Field label="IFSC Code" value={form.bankIfscCode} onChange={set('bankIfscCode')} />
          <Field label="SWIFT Code" value={form.bankSwiftCode} onChange={set('bankSwiftCode')} />
          <Field label="Branch" value={form.bankBranch} onChange={set('bankBranch')} />
          <Field label="UPI ID" value={form.upiId} onChange={set('upiId')} />
        </Section>

        <Section
          title="Invoice Defaults"
          description="Default Payment Terms and Payment Instructions bullets shown on invoice PDFs - overridable per invoice when it's created"
        >
          <div className="sm:col-span-2">
            <TextAreaField
              label="Payment Terms"
              value={form.invoicePaymentTerms}
              onChange={set('invoicePaymentTerms')}
              helperText="One bullet per line"
            />
          </div>
          <div className="sm:col-span-2">
            <TextAreaField
              label="Payment Instructions"
              value={form.invoicePaymentInstructions}
              onChange={set('invoicePaymentInstructions')}
              helperText="One bullet per line, shown below the bank details"
            />
          </div>
        </Section>
      </div>
      </div>
  );
};

export default OrganizationSettings;
