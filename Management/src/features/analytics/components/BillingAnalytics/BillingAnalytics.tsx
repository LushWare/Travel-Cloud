import { useEffect, useState } from 'react';
import {
  TimeRangeFilter,
  ChartContainer,
  AreaChartComponent,
  PieChartComponent,
  BarChartComponent,
} from '../Common';
import { CHART_PALETTE } from '../Common/chartTheme';
import { DollarSign, Wallet, TrendingUp, Download, Receipt } from 'lucide-react';
import { analyticsAPI } from '../../../../services/api';
import { exportBillingAnalyticsPDF } from '../../utils/exportAnalytics';
import toast from '@/lib/toast';
import { formatCompact, formatCurrency, getCurrencySymbol } from '../../../../utils/currency.js';
import { StatCard } from '../../../../components/shared/StatCard';
import { Button } from '../../../../components/ui/button';
import { apiErrorMessage } from '@/lib/apiErrorMessage';

/**
 * BillingAnalytics Component
 */
const BillingAnalytics = () => {
  const [timeRange, setTimeRange] = useState('monthly');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [stats, setStats] = useState({
    totalRevenue: 0,
    totalOutstanding: 0,
    totalPotentialRevenue: 0,
    pendingInvoices: 0,
  });
  const [revenueTrendData, setRevenueTrendData] = useState<any[]>([]);
  const [outstandingTrendData, setOutstandingTrendData] = useState<any[]>([]);
  const [paymentStatusData, setPaymentStatusData] = useState<any[]>([]);
  const [invoiceBreakdownData, setInvoiceBreakdownData] = useState<any[]>([]);

  const formatShort = (value: number) => {
    return `${getCurrencySymbol()}${formatCompact(value)}`;
  };

  const calculateTrend = (current: number, previous: number) => {
    if (!previous || previous === 0) return current ? '100.0' : '0.0';
    return (((current - previous) / previous) * 100).toFixed(1);
  };

  const getLastTwoValues = (data: any[], key: string) => {
    if (!data || data.length < 2) return { current: 0, previous: 0 };
    const previous = data[data.length - 2]?.[key] || 0;
    const current = data[data.length - 1]?.[key] || 0;
    return { current, previous };
  };

  useEffect(() => {
    const fetchBillingAnalytics = async () => {
      setLoading(true);
      setErrorMessage('');
      try {
        const response = await analyticsAPI.getBillingOverview({ timeRange });
        const payload = response?.data || {};
        setStats({
          totalRevenue: payload?.stats?.totalRevenue || 0,
          totalOutstanding: payload?.stats?.totalOutstanding || 0,
          totalPotentialRevenue: payload?.stats?.totalPotentialRevenue || 0,
          pendingInvoices: payload?.stats?.pendingInvoices || 0,
        });
        setRevenueTrendData(payload?.revenueTrend || []);
        setOutstandingTrendData(payload?.outstandingTrend || []);
        setPaymentStatusData(
          (payload?.paymentStatusDistribution || []).map((item: any) => ({
            ...item,
            name: item?.name || item?.status || 'Unknown',
            value: item?.totalAmount || 0,
          }))
        );
        setInvoiceBreakdownData(payload?.invoiceCategoryBreakdown || []);
      } catch (error: any) {
        console.error('Failed to load billing analytics', error);
        setErrorMessage(apiErrorMessage(error));
        setStats({ totalRevenue: 0, totalOutstanding: 0, totalPotentialRevenue: 0, pendingInvoices: 0 });
        setRevenueTrendData([]);
        setOutstandingTrendData([]);
        setPaymentStatusData([]);
        setInvoiceBreakdownData([]);
      } finally {
        setLoading(false);
      }
    };
    fetchBillingAnalytics();
  }, [timeRange]);

  const handleExportPDF = async () => {
    try {
      setExporting(true);
      const toastId = toast.loading('Preparing billing analytics PDF...');
      const summaryMetrics = [
        { label: 'Total Revenue', value: formatCurrency(stats.totalRevenue) },
        { label: 'Outstanding Amount', value: formatCurrency(stats.totalOutstanding) },
        { label: 'Potential Revenue', value: formatCurrency(stats.totalPotentialRevenue) },
        { label: 'Pending Invoices', value: stats.pendingInvoices },
        { label: 'Time Range', value: timeRange.toUpperCase() },
      ];
      await exportBillingAnalyticsPDF({ timeRange, summaryMetrics });
      toast.dismiss(toastId);
      toast.success('Billing analytics PDF downloaded successfully!');
    } catch (error) {
      console.error('Error exporting PDF:', error);
      toast.error('Failed to export analytics PDF');
    } finally {
      setExporting(false);
    }
  };

  const revenueTrend = getLastTwoValues(revenueTrendData, 'revenue');

  const revenueAreas = [
    { dataKey: 'revenue', fill: CHART_PALETTE[1], stroke: CHART_PALETTE[1], name: 'Revenue' },
    { dataKey: 'target', fill: 'var(--color-muted-foreground)', stroke: 'var(--color-muted-foreground)', name: 'Target' },
  ];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="font-heading text-xl font-bold text-foreground">Billing & Revenue</h2>
          <p className="text-sm text-muted-foreground mt-1">Track invoices, payments, and financial performance</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <TimeRangeFilter selectedRange={timeRange} onRangeChange={setTimeRange} />
          <Button onClick={handleExportPDF} disabled={exporting || loading}>
            <Download className="w-4 h-4" />
            {exporting ? 'Exporting...' : 'Export'}
          </Button>
        </div>
      </div>

      {/* Revenue Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={DollarSign}
          label="Total Revenue"
          value={formatShort(stats.totalRevenue)}
          subtitle={`${calculateTrend(revenueTrend.current, revenueTrend.previous)}% from last period`}
          color="success"
        />
        <StatCard
          icon={Wallet}
          label="Outstanding"
          value={formatShort(stats.totalOutstanding)}
          subtitle={`${stats.pendingInvoices} pending invoices`}
          color="warning"
        />
        <StatCard
          icon={TrendingUp}
          label="Potential"
          value={formatShort(stats.totalPotentialRevenue)}
          subtitle="Available to collect"
          color="primary"
        />
        <StatCard
          icon={Receipt}
          label="Invoices"
          value={stats.pendingInvoices}
          subtitle="Awaiting payment"
          color="muted"
        />
      </div>

      {/* Revenue Trend - Full Width */}
      <ChartContainer
        title="Revenue Trend"
        description={`${timeRange.charAt(0).toUpperCase() + timeRange.slice(1)} revenue vs targets`}
      >
        {loading ? (
          <div className="flex items-center justify-center h-[320px]">
            <div className="animate-spin w-8 h-8 border-4 border-muted border-t-primary rounded-full" />
          </div>
        ) : revenueTrendData.length > 0 ? (
          <AreaChartComponent data={revenueTrendData} areas={revenueAreas} xAxisKey="label" height={320} />
        ) : (
          <div className="flex items-center justify-center h-[320px] text-muted-foreground text-sm">
            {errorMessage || 'No revenue data available'}
          </div>
        )}
      </ChartContainer>

      {/* Payment Status & Outstanding - 2 Columns */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <ChartContainer
          title="Payment Status"
          description="Distribution of payment statuses"
        >
          {loading ? (
            <div className="flex items-center justify-center h-[280px]">
              <div className="animate-spin w-8 h-8 border-4 border-muted border-t-primary rounded-full" />
            </div>
          ) : paymentStatusData.some((item) => item.value > 0) ? (
            <PieChartComponent
              data={paymentStatusData}
              dataKey="value"
              nameKey="name"
              height={280}
              totalFormatter={(total) => total.toFixed(2)}
            />
          ) : (
            <div className="flex items-center justify-center h-[280px] text-muted-foreground text-sm">
              No payment status data available
            </div>
          )}
        </ChartContainer>

        <ChartContainer
          title="Outstanding Trend"
          description="Pending payments over time"
        >
          {loading ? (
            <div className="flex items-center justify-center h-[280px]">
              <div className="animate-spin w-8 h-8 border-4 border-muted border-t-primary rounded-full" />
            </div>
          ) : outstandingTrendData.length > 0 ? (
            <AreaChartComponent
              data={outstandingTrendData}
              areas={[
                { dataKey: 'outstanding', fill: CHART_PALETTE[0], stroke: CHART_PALETTE[0], name: 'Outstanding' },
                { dataKey: 'potentialRevenue', fill: CHART_PALETTE[1], stroke: CHART_PALETTE[1], name: 'Potential' },
              ]}
              xAxisKey="label"
              height={280}
            />
          ) : (
            <div className="flex items-center justify-center h-[280px] text-muted-foreground text-sm">
              No outstanding data available
            </div>
          )}
        </ChartContainer>
      </div>

      {/* Invoice Breakdown - Full Width */}
      <ChartContainer
        title="Invoice Breakdown"
        description="Revenue and invoices by category"
      >
        {loading ? (
          <div className="flex items-center justify-center h-[280px]">
            <div className="animate-spin w-8 h-8 border-4 border-muted border-t-primary rounded-full" />
          </div>
        ) : invoiceBreakdownData.length > 0 ? (
          <BarChartComponent
            data={invoiceBreakdownData}
            bars={[
              { dataKey: 'revenue', fill: CHART_PALETTE[0], name: 'Revenue' },
              { dataKey: 'invoices', fill: CHART_PALETTE[1], name: 'Invoices' },
            ]}
            xAxisKey="name"
            height={280}
          />
        ) : (
          <div className="flex items-center justify-center h-[280px] text-muted-foreground text-sm">
            No invoice data available
          </div>
        )}
      </ChartContainer>
    </div>
  );
};

export default BillingAnalytics;
