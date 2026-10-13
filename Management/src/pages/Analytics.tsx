import { useEffect, useState, type ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  LeadAnalytics,
  BillingAnalytics,
  UserAnalytics,
  PackageAnalytics,
  WebsiteAnalytics,
  MyPerformanceAnalytics,
} from '../features/analytics/components';
import {
  Users, DollarSign, Globe, Briefcase,
  TrendingUp, ArrowRight, Layers, Zap
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useSearchParams } from 'react-router-dom';

import PageHeader from '../components/PageHeader';
import RecommendationStrip from '@/features/recommendations/RecommendationStrip';

// Package, Website, and User analytics are admin-only on the backend
// (company-wide data with no per-rep ownership) — hide them from salesRep
// instead of showing a tab that 403s.
const ADMIN_ONLY_TAB_IDS = ['itineraries', 'website', 'users'];

// "My Performance" is scoped to req.user.id server-side — meaningless for an
// admin account (which already has the org-wide salesrep-comparison view), so
// keep it salesRep-only rather than showing it to everyone.
const SALESREP_ONLY_TAB_IDS = ['my-performance'];

interface AnalyticsTab {
  id: string;
  label: string;
  shortLabel: string;
  icon: LucideIcon;
  component: ComponentType;
}

/**
 * Analytics Main Page - Responsive Design
 * Desktop: Vertical sidebar navigation with main content area
 * Mobile: Horizontal scrollable tabs with full-width content
 */
const Analytics = () => {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(() => searchParams.get('tab') || 'leads');
  const allTabs: AnalyticsTab[] = [
    { id: 'leads', label: 'Lead Analytics', shortLabel: 'Leads', icon: TrendingUp, component: LeadAnalytics },
    { id: 'billing', label: 'Billing Analytics', shortLabel: 'Billing', icon: DollarSign, component: BillingAnalytics },
    { id: 'users', label: 'User Analytics', shortLabel: 'Users', icon: Users, component: UserAnalytics },
    { id: 'itineraries', label: 'Package Analytics', shortLabel: 'Packages', icon: Briefcase, component: PackageAnalytics },
    { id: 'website', label: 'Website Analytics', shortLabel: 'Website', icon: Globe, component: WebsiteAnalytics },
    { id: 'my-performance', label: 'My Performance', shortLabel: 'My Stats', icon: Zap, component: MyPerformanceAnalytics },
  ];

  const tabs = allTabs.filter((tab) => {
    if (user?.role === 'salesRep') return !ADMIN_ONLY_TAB_IDS.includes(tab.id);
    return !SALESREP_ONLY_TAB_IDS.includes(tab.id);
  });

  const activeTabData = tabs.find(t => t.id === activeTab) || tabs[0];
  const ActiveComponent = activeTabData?.component;

  useEffect(() => {
    const requested = searchParams.get('tab');
    const next = tabs.some((tab) => tab.id === requested) ? requested! : tabs[0]?.id || 'leads';
    if (next !== activeTab) setActiveTab(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tab availability changes only with the actor role
  }, [searchParams, user?.role]);

  const changeTab = (tab: string) => {
    setActiveTab(tab);
    setSearchParams({ tab });
  };

  return (
    <>
      <PageHeader title="Analytics" subtitle={activeTabData?.label} />
      <RecommendationStrip module="analytics" />

      <div className="h-full flex flex-col md:flex-row bg-background">
        {/* Mobile: horizontal tabs. The title row moved into PageHeader, so this
            block is no longer sticky — there is one sticky bar. */}
        <div className="md:hidden bg-card border-b border-border">
          {/* Horizontal scrollable tabs */}
          <div className="flex overflow-x-auto px-3 pb-3 gap-2 scrollbar-hide">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => changeTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors flex-shrink-0 ${
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-accent'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.shortLabel}
                </button>
              );
            })}
          </div>
        </div>

        {/* Desktop Left Sidebar Navigation */}
        <div className="hidden md:flex w-64 bg-card border-r border-border flex-shrink-0 flex-col">
          {/* Navigation Items */}
          <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
            <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold px-3 mb-3">Reports</p>
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;

              return (
                <button
                  key={tab.id}
                  onClick={() => changeTab(tab.id)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg transition-colors duration-150 group ${isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-muted text-foreground'
                    }`}
                >
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${isActive ? 'bg-primary-foreground/15' : 'bg-muted group-hover:bg-accent'
                      }`}
                  >
                    <Icon className={`w-4 h-4 ${isActive ? 'text-primary-foreground' : 'text-muted-foreground'}`} />
                  </div>
                  <span className={`text-sm font-medium flex-1 text-left ${isActive ? 'text-primary-foreground' : 'text-foreground'}`}>
                    {tab.label}
                  </span>
                  {isActive && (
                    <ArrowRight className="w-4 h-4 text-primary-foreground/70" />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Footer Info */}
          <div className="p-4 border-t border-border">
            <div className="p-4 bg-muted/50 rounded-lg border border-border">
              <div className="flex items-center gap-2 mb-2">
                <Layers className="w-4 h-4 text-muted-foreground" />
                <span className="text-xs font-semibold text-foreground">Quick Tip</span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Use time filters in each report to analyze specific periods.
              </p>
            </div>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto">
            <div className="p-4 sm:p-6 lg:p-8">
              <div className="bg-card rounded-xl border border-border shadow-card overflow-hidden">
                <div className="p-4 sm:p-6 lg:p-8">
                  {ActiveComponent && <ActiveComponent />}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default Analytics;
