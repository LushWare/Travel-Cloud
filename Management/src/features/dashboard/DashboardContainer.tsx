import { useState, useEffect, type ReactNode } from 'react';
import { usePermission } from '../../contexts/PermissionContext';
import { formatPercent } from '@/utils/number';
import { useAuth } from '../../contexts/AuthContext';
import type { LucideIcon } from 'lucide-react';
import {
  Users, DollarSign, Activity, Briefcase,
  Eye, RefreshCw, Clock, Target,
  TrendingUp, Zap, Layers, PieChart as PieChartIcon
} from 'lucide-react';
import {
  AreaChart, Area, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, BarChart, Bar, RadialBarChart, RadialBar
} from 'recharts';

import AnalyticsService from '../../services/analytics.service';
import { formatCompact } from '../../utils/currency.js';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { Button } from '../../components/ui/button';
import { StatCard, type StatCardColor } from '../../components/shared/StatCard';
import PageHeader from '../../components/PageHeader';
import RecommendationStrip from '@/features/recommendations/RecommendationStrip';

// Shared theming for recharts, which takes literal CSS color strings rather
// than Tailwind classes — referencing the same CSS custom properties that
// back the chart-*/border/muted-foreground/popover utilities keeps these in
// sync with the token system (including live light/dark switching, since the
// browser re-resolves var() on every paint) instead of hardcoding hex twice.
const chartTooltipStyle = {
  backgroundColor: 'var(--color-popover)',
  color: 'var(--color-popover-foreground)',
  border: '1px solid var(--color-border)',
  borderRadius: '8px',
  boxShadow: 'var(--shadow-dropdown)',
  fontSize: '13px',
};
const chartGridColor = 'var(--color-border)';
const chartAxisColor = 'var(--color-muted-foreground)';

// ============================================
// LOADING STATE
// ============================================
const LoadingState = () => (
  <div className="h-full flex flex-col items-center justify-center bg-background">
    <div className="relative w-16 h-16 flex items-center justify-center rounded-xl bg-primary/10">
      <Layers className="w-7 h-7 text-primary animate-pulse" />
    </div>
    <p className="mt-6 text-sm font-medium text-foreground">Preparing Dashboard</p>
  </div>
);

// ============================================
// CHART WRAPPER
// ============================================
interface ChartPanelProps {
  title: string;
  subtitle?: string;
  icon: LucideIcon;
  children: ReactNode;
  actions?: React.ReactNode;
  height?: number;
}

const ChartPanel = ({ title, subtitle, icon: Icon, children, actions, height = 320 }: ChartPanelProps) => (
  <Card className="shadow-card">
    <CardHeader className="flex-row items-center justify-between border-b pb-4">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
          <Icon className="w-4 h-4 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <CardTitle className="truncate">{title}</CardTitle>
          {subtitle && <CardDescription className="hidden sm:block">{subtitle}</CardDescription>}
        </div>
      </div>
      {actions && <div className="flex-shrink-0">{actions}</div>}
    </CardHeader>
    <CardContent style={{ height: Math.min(height, typeof window !== 'undefined' && window.innerWidth < 640 ? 240 : height) }}>
      {children}
    </CardContent>
  </Card>
);

// ============================================
// TIME SELECTOR
// ============================================
interface TimeSelectorProps {
  selected: string;
  onChange: (value: string) => void;
}

const TimeSelector = ({ selected, onChange }: TimeSelectorProps) => (
  <Tabs value={selected} onValueChange={(value) => value && onChange(String(value))}>
    <TabsList>
      <TabsTrigger value="daily">Day</TabsTrigger>
      <TabsTrigger value="weekly">Week</TabsTrigger>
      <TabsTrigger value="monthly">Month</TabsTrigger>
      <TabsTrigger value="annual">Year</TabsTrigger>
    </TabsList>
  </Tabs>
);

// ============================================
// LEAD FUNNEL - AREA CHART
// ============================================
const LeadFunnelChart = ({ data }: { data: any }) => {
  const trendData = data?.trend || [];

  if (!trendData.length) {
    return <div className="h-full flex items-center justify-center text-muted-foreground text-sm">No data available</div>;
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={trendData}>
        <defs>
          <linearGradient id="colorNew" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-chart-1)" stopOpacity={0.3} />
            <stop offset="95%" stopColor="var(--color-chart-1)" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="colorConverted" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-chart-2)" stopOpacity={0.3} />
            <stop offset="95%" stopColor="var(--color-chart-2)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} vertical={false} />
        <XAxis dataKey="label" stroke={chartAxisColor} fontSize={11} tickLine={false} axisLine={false} />
        <YAxis stroke={chartAxisColor} fontSize={11} tickLine={false} axisLine={false} />
        <Tooltip contentStyle={chartTooltipStyle} />
        <Area type="monotone" dataKey="new" stroke="var(--color-chart-1)" strokeWidth={2} fill="url(#colorNew)" name="New Leads" />
        <Area type="monotone" dataKey="converted" stroke="var(--color-chart-2)" strokeWidth={2} fill="url(#colorConverted)" name="Converted" />
        <Line type="monotone" dataKey="contacted" stroke="var(--color-chart-3)" strokeWidth={2} dot={false} name="Contacted" />
        <Line type="monotone" dataKey="interested" stroke="var(--color-chart-4)" strokeWidth={2} dot={false} name="Interested" />
      </AreaChart>
    </ResponsiveContainer>
  );
};

// ============================================
// PACKAGE DISTRIBUTION - RADIAL BAR CHART
// ============================================
const chartPalette = ['var(--color-chart-1)', 'var(--color-chart-2)', 'var(--color-chart-3)', 'var(--color-chart-4)', 'var(--color-chart-5)'];

const PackageRadialChart = ({ data }: { data: any }) => {
  const destinationData = data?.destinationPerformance || [];
  const chartData = destinationData.slice(0, 5).map((item: any, idx: number) => ({
    name: item.destination || item.name || 'Unknown',
    value: item.inquiries || item.value || 0,
    fill: chartPalette[idx],
  })).filter((item: any) => item.value > 0);

  if (!chartData.length) {
    return <div className="h-full flex items-center justify-center text-muted-foreground text-sm">No data available</div>;
  }

  return (
    <div className="h-full flex">
      <div className="flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart
            cx="50%"
            cy="50%"
            innerRadius="30%"
            outerRadius="90%"
            data={chartData}
            startAngle={180}
            endAngle={-180}
          >
            <RadialBar
              background={{ fill: 'var(--color-muted)' }}
              dataKey="value"
              cornerRadius={10}
            />
            <Tooltip contentStyle={chartTooltipStyle} />
          </RadialBarChart>
        </ResponsiveContainer>
      </div>
      <div className="w-32 flex flex-col justify-center gap-2">
        {chartData.map((item: any, idx: number) => (
          <div key={idx} className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.fill }} />
            <span className="text-xs text-muted-foreground truncate">{item.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ============================================
// REVENUE CHART - VERTICAL BARS
// ============================================
const RevenueBarChart = ({ data }: { data: any }) => {
  const revenueTrend = data?.revenueTrend || [];

  if (!revenueTrend.length) {
    return <div className="h-full flex items-center justify-center text-muted-foreground text-sm">No data available</div>;
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={revenueTrend} barGap={8}>
        <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} vertical={false} />
        <XAxis dataKey="label" stroke={chartAxisColor} fontSize={11} tickLine={false} axisLine={false} />
        <YAxis stroke={chartAxisColor} fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => formatCompact(v)} />
        <Tooltip formatter={(value: number) => formatCompact(value)} contentStyle={chartTooltipStyle} />
        <Bar dataKey="revenue" fill="var(--color-chart-2)" radius={[6, 6, 0, 0]} name="Revenue" />
        <Bar dataKey="target" fill="var(--color-muted)" radius={[6, 6, 0, 0]} name="Target" />
      </BarChart>
    </ResponsiveContainer>
  );
};

// ============================================
// REVENUE SUMMARY CARDS
// ============================================
const RevenueSummaryCards = ({ data }: { data: any }) => {
  if (!data?.stats) return null;

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 mt-4">
      <StatCard
        icon={Eye}
        label="Outstanding"
        value={formatCompact(data.stats.currentOutstanding ?? data.stats.totalOutstanding)}
        color="warning"
      />
      <StatCard
        icon={DollarSign}
        label="Draft Pipeline"
        value={formatCompact(data.stats.totalPotentialRevenue)}
        subtitle="Draft invoices not yet sent"
        color="success"
      />
    </div>
  );
};

// ============================================
// USER ANALYTICS
// ============================================
const UserAnalyticsPanel = ({ data }: { data: any }) => {
  const userStats = data?.stats || {};
  const roleDistribution = data?.roleDistribution || [];

  return (
    <div className="h-full flex flex-col">
      <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-4 sm:mb-6">
        <div className="text-center p-3 sm:p-4 bg-muted rounded-lg">
          <p className="text-xl sm:text-3xl font-mono font-semibold tabular-nums text-foreground">{userStats.totalUsers || 0}</p>
          <p className="text-xs text-muted-foreground mt-1">New Users</p>
        </div>
        <div className="text-center p-3 sm:p-4 bg-success/10 rounded-lg">
          <p className="text-xl sm:text-3xl font-mono font-semibold tabular-nums text-success">{userStats.activeUsers || 0}</p>
          <p className="text-xs text-muted-foreground mt-1">Active New Users</p>
        </div>
        <div className="text-center p-3 sm:p-4 bg-destructive/10 rounded-lg">
          <p className="text-xl sm:text-3xl font-mono font-semibold tabular-nums text-destructive">{userStats.inactiveUsers || 0}</p>
          <p className="text-xs text-muted-foreground mt-1">Inactive New Users</p>
        </div>
      </div>

      {roleDistribution.length > 0 && (
        <div className="flex-1">
          <p className="text-xs font-semibold tracking-wide uppercase text-muted-foreground mb-3">Role Distribution</p>
          <div className="space-y-3">
            {roleDistribution.map((role: any, idx: number) => {
              const percentage = Math.round((role.count / (userStats.totalUsers || 1)) * 100);
              return (
                <div key={idx}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-foreground capitalize">{role.role}</span>
                    <span className="font-mono tabular-nums text-muted-foreground">{role.count} ({percentage}%)</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all duration-500"
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================
// SALES REP PERFORMANCE
// ============================================
const SalesRepDashboard = ({ data }: { data: any }) => {
  if (!data) return null;
  const performance = data?.performance || {};

  const repStats: { icon: LucideIcon; label: string; value: string | number; color: StatCardColor }[] = [
    { icon: Users, label: 'Leads Assigned', value: performance.leadsAssigned || 0, color: 'muted' },
    { icon: Target, label: 'Converted', value: performance.converted || 0, color: 'success' },
    { icon: Clock, label: 'Pending', value: performance.pending || 0, color: 'warning' },
    { icon: TrendingUp, label: 'Conversion Rate', value: formatPercent(performance.conversionRate), color: 'primary' },
  ];

  return (
    <Card className="mb-6 sm:mb-8 bg-primary/5">
      <CardHeader className="flex-row items-center gap-3">
        <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-primary flex items-center justify-center flex-shrink-0">
          <Zap className="w-5 h-5 sm:w-6 sm:h-6 text-primary-foreground" />
        </div>
        <div>
          <CardTitle className="text-base sm:text-lg">Your Performance</CardTitle>
          <CardDescription>Personal metrics for this period</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {repStats.map((stat) => (
          <StatCard key={stat.label} {...stat} />
        ))}
      </CardContent>
    </Card>
  );
};

// ============================================
// MAIN DASHBOARD CONTAINER
// ============================================
interface Metric {
  title: string;
  value: string | number;
  subtitle?: string;
  trend: string | null;
  icon: LucideIcon;
  color: StatCardColor;
}

const DashboardContainer = () => {
  const { user } = useAuth();
  const { hasPermission } = usePermission();

  const [timeRange, setTimeRange] = useState('monthly');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [leadData, setLeadData] = useState<any>(null);
  const [billingData, setBillingData] = useState<any>(null);
  const [packageData, setPackageData] = useState<any>(null);
  const [userData, setUserData] = useState<any>(null);
  const [salesRepData, setSalesRepData] = useState<any>(null);

  const canViewBilling = hasPermission('manage_billing') || user?.role === 'superAdmin';
  const canViewUsers = (hasPermission('view_reports') || user?.role === 'superAdmin') && user?.role !== 'salesRep';
  const isSalesRep = user?.role === 'salesRep';

  const fetchData = async () => {
    setLoading(!refreshing);
    setError(null);

    try {
      const requests = [
        AnalyticsService.getLeadAnalyticsOverview(timeRange).then((d: any) => setLeadData(d)).catch(() => { }),
        AnalyticsService.getPackageAnalyticsOverview(timeRange).then((d: any) => setPackageData(d)).catch(() => { }),
      ];

      if (canViewBilling) {
        requests.push(AnalyticsService.getBillingAnalyticsOverview(timeRange).then((d: any) => setBillingData(d)).catch(() => { }));
      }
      if (canViewUsers) {
        requests.push(AnalyticsService.getUserAnalyticsOverview(timeRange).then((d: any) => setUserData(d)).catch(() => { }));
      }
      if (isSalesRep) {
        requests.push(AnalyticsService.getSalesRepPerformance(timeRange).then((d: any) => setSalesRepData(d)).catch(() => { }));
      }

      await Promise.all(requests);
    } catch {
      setError('Failed to load data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { fetchData(); }, [timeRange, canViewBilling, canViewUsers, isSalesRep]);

  if (loading && !refreshing) return <LoadingState />;

  const leadStats = leadData?.stats || {};
  const billingStats = billingData?.stats || {};
  const userStats = userData?.stats || {};
  const packageStats = packageData?.stats || {};

  // Real period-over-period deltas from the trend series (same approach as
  // BillingAnalytics's calculateTrend/getLastTwoValues) — no fabricated %s.
  // Omits the badge entirely when there aren't at least 2 buckets to compare.
  const trendBadge = (series: any[], key: string): string | null => {
    if (!Array.isArray(series) || series.length < 2) return null;
    const previous = Number(series[series.length - 2]?.[key]) || 0;
    const current = Number(series[series.length - 1]?.[key]) || 0;
    if (previous === 0) return null;
    const pct = ((current - previous) / previous) * 100;
    return `${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%`;
  };
  const trendDirection = (trend: string | null): 'up' | 'down' => (trend?.startsWith('-') ? 'down' : 'up');

  const metrics: Metric[] = [
    { title: 'Total Leads', value: leadStats.allTimeTotalLeads || '0', trend: null, icon: Activity, color: 'primary' },
    { title: 'Active Packages', value: packageStats.totalItineraries || '0', trend: null, icon: Briefcase, color: 'muted' },
  ];

  if (billingData) {
    metrics.push(
      { title: 'Collected Revenue', value: formatCompact(billingStats.totalRevenue), trend: trendBadge(billingData?.revenueTrend, 'revenue'), icon: DollarSign, color: 'success' },
      { title: 'Outstanding', value: formatCompact(billingStats.currentOutstanding ?? billingStats.totalOutstanding), trend: null, icon: Eye, color: 'warning' },
    );
  }

  if (userData && !isSalesRep) {
    metrics.push(
      { title: 'Total Users', value: userStats.allTimeTotalUsers ?? userStats.totalUsers ?? 0, trend: null, icon: Users, color: 'muted' },
      { title: 'Active Users', value: userStats.activeUsers || '0', trend: trendBadge(userData?.trendData, 'activeUsers'), icon: TrendingUp, color: 'success' },
    );
  }

  return (
    <div className="h-full overflow-auto bg-background">
      <PageHeader
        title="Dashboard"
        subtitle={`Welcome back, ${user?.name || 'User'}`}
        actions={
          <>
            <Button
              variant="outline"
              size="icon"
              onClick={() => { setRefreshing(true); fetchData(); }}
              disabled={refreshing}
              className={refreshing ? 'animate-spin' : ''}
              aria-label="Refresh dashboard"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
            <TimeSelector selected={timeRange} onChange={setTimeRange} />
          </>
        }
      />

      <div className="p-4 sm:p-6 lg:p-8 space-y-6 sm:space-y-8">
        {error && (
          <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm flex items-center justify-between">
            {error}
            <Button variant="link" size="sm" onClick={() => setError(null)} className="text-destructive">Dismiss</Button>
          </div>
        )}

        {/* Sales Rep Dashboard */}
        {isSalesRep && <SalesRepDashboard data={salesRepData} />}

        {/* Metrics Grid - responsive columns */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-5">
          {metrics.map((metric) => (
            <StatCard
              key={metric.title}
              icon={metric.icon}
              label={metric.title}
              value={metric.value}
              subtitle={metric.subtitle}
              trend={metric.trend || undefined}
              trendDirection={trendDirection(metric.trend)}
              color={metric.color}
            />
          ))}
        </div>

        <RecommendationStrip module="dashboard" />

        {/* Charts Row 1 - Lead Funnel (wide) + Package Distribution */}
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-4 sm:gap-6">
          <div className="xl:col-span-3">
            <ChartPanel title="Lead Pipeline Trends" subtitle="New leads vs conversions over time" icon={TrendingUp} height={260}>
              <LeadFunnelChart data={leadData} />
            </ChartPanel>
          </div>
          <div className="xl:col-span-2">
            <ChartPanel title="Destination Popularity" subtitle="Top destinations by inquiries" icon={PieChartIcon} height={260}>
              <PackageRadialChart data={packageData} />
            </ChartPanel>
          </div>
        </div>

        {/* Charts Row 2 - Revenue Performance (for billing admins) */}
        {canViewBilling && (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 sm:gap-6">
            <div className="xl:col-span-2">
              <ChartPanel title="Revenue Performance" subtitle="Monthly revenue vs targets" icon={DollarSign} height={260}>
                <RevenueBarChart data={billingData} />
              </ChartPanel>
            </div>
            <div className="flex flex-col justify-center">
              <RevenueSummaryCards data={billingData} />
            </div>
          </div>
        )}

        {/* Charts Row 3 - User Analytics (for admins) */}
        {canViewUsers && (
          <ChartPanel title="User Analytics" subtitle="Accounts registered in selected period" icon={Users} height={320}>
            <UserAnalyticsPanel data={userData} />
          </ChartPanel>
        )}
      </div>
    </div>
  );
};

export default DashboardContainer;
