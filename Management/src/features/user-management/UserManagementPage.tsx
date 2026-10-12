import { useState, useMemo, type ComponentType } from 'react';
import { Users, Shield, UserCheck, Building2, Lock } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AdminManagement } from './components/AdminManagement';
import { SalesRepManagement } from './components/SalesRepManagement';
import { VendorManagement } from './components/VendorManagement';
import { WebsiteUsersManagement } from './components/WebsiteUsersManagement';
import { usePermission } from '../../contexts/PermissionContext';
import PageHeader from '@/components/PageHeader';
import RecommendationStrip from '@/features/recommendations/RecommendationStrip';

interface ManagementTab {
  id: string;
  label: string;
  shortLabel: string;
  icon: ComponentType<{ className?: string }>;
  description: string;
  requiredPermission: string;
  component: ComponentType;
}

/**
 * UserManagementPage
 * Left sidebar navigation (desktop) / horizontal tab strip (mobile) over
 * the four user-management sections.
 */
const UserManagementPage = () => {
  const permission = usePermission();
  const [activeTab, setActiveTab] = useState<string | null>(null);

  const allTabs: ManagementTab[] = [
    {
      id: 'admins',
      label: 'Administrators',
      shortLabel: 'Admins',
      icon: Shield,
      description: 'Manage system admins and their permissions',
      requiredPermission: 'manage_admins',
      component: AdminManagement,
    },
    {
      id: 'sales-reps',
      label: 'Sales Representatives',
      shortLabel: 'Sales Reps',
      icon: UserCheck,
      description: 'Sales team management and performance tracking',
      requiredPermission: 'manage_sales_reps',
      component: SalesRepManagement,
    },
    {
      id: 'vendors',
      label: 'Vendor Partners',
      shortLabel: 'Vendors',
      icon: Building2,
      description: 'Hotels, agents, and service providers',
      requiredPermission: 'manage_vendors',
      component: VendorManagement,
    },
    {
      id: 'website-users',
      label: 'Website Users',
      shortLabel: 'Customers',
      icon: Users,
      description: 'Platform customers and their bookings',
      requiredPermission: 'manage_users',
      component: WebsiteUsersManagement,
    },
  ];

  const accessibleTabs = useMemo(() => {
    return allTabs.filter((tab) => permission.hasPermission(tab.requiredPermission));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permission]);

  const currentActiveTab = useMemo(() => {
    if (!activeTab && accessibleTabs.length > 0) {
      return accessibleTabs[0].id;
    }
    return activeTab || null;
  }, [activeTab, accessibleTabs]);

  const handleTabChange = (tabId: string) => {
    const tab = accessibleTabs.find((t) => t.id === tabId);
    if (tab && permission.hasPermission(tab.requiredPermission)) {
      setActiveTab(tabId);
    }
  };

  const currentTab = allTabs.find((t) => t.id === currentActiveTab);

  const renderContent = () => {
    const tab = accessibleTabs.find((t) => t.id === currentActiveTab);

    if (!tab) {
      return (
        <div className="flex h-[60vh] flex-col items-center justify-center text-center">
          <div className="mb-6 flex size-20 items-center justify-center rounded-full bg-muted">
            <Lock className="size-10 text-muted-foreground" />
          </div>
          <h3 className="mb-2 font-heading text-xl font-semibold text-foreground">Access Restricted</h3>
          <p className="max-w-md text-muted-foreground">
            You don't have permission to access any user management sections. Contact your administrator for access.
          </p>
        </div>
      );
    }

    const Component = tab.component;
    return <Component />;
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Mobile Header + Horizontal Tabs */}
      <PageHeader title="User Management" subtitle={currentTab?.description} />
      <div className="px-4 pt-4 md:px-6"><RecommendationStrip module="users" /></div>

      {/* Mobile sections. The title row moved into PageHeader, so this block is
          no longer sticky — there is one sticky bar. */}
      <div className="border-b border-border bg-card md:hidden">
        {accessibleTabs.length > 0 ? (
          <Tabs value={currentActiveTab ?? undefined} onValueChange={(v) => handleTabChange(v as string)} className="px-3 pb-3">
            <TabsList className="w-full overflow-x-auto scrollbar-hide">
              {accessibleTabs.map((tab) => {
                const TabIcon = tab.icon;
                return (
                  <TabsTrigger key={tab.id} value={tab.id} className="gap-1.5">
                    <TabIcon className="size-4" />
                    {tab.shortLabel}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Tabs>
        ) : (
          <div className="px-3 pb-3 text-sm text-muted-foreground">No sections available</div>
        )}
      </div>

      <div className="relative flex flex-col md:flex-row">
        {/* Left Sidebar Navigation - Desktop only */}
        <aside className="sticky top-0 hidden h-screen w-72 flex-col overflow-y-auto border-r border-border bg-card pb-4 md:flex">
          {/* Sidebar Header */}
          <div className="border-b border-border p-6">
            {/* Quick Stats Row */}
            <div className="flex gap-2">
              <div className="flex-1 rounded-lg bg-muted p-2 text-center">
                <p className="font-mono text-lg font-bold tabular-nums text-foreground">{accessibleTabs.length}</p>
                <p className="text-xs tracking-wider text-muted-foreground uppercase">Sections</p>
              </div>
              <div className="flex-1 rounded-lg bg-muted p-2 text-center">
                <p className="text-lg font-bold text-success">Active</p>
                <p className="text-xs tracking-wider text-muted-foreground uppercase">Status</p>
              </div>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="flex-1 space-y-2 p-4">
            <p className="px-3 py-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              User Categories
            </p>

            {accessibleTabs.length > 0 ? (
              accessibleTabs.map((tab) => {
                const TabIcon = tab.icon;
                const isActive = currentActiveTab === tab.id;

                return (
                  <button
                    key={tab.id}
                    onClick={() => handleTabChange(tab.id)}
                    className={`w-full rounded-xl p-3 text-left transition-colors ${
                      isActive ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${
                          isActive ? 'bg-primary-foreground/20' : 'bg-primary/10'
                        }`}
                      >
                        <TabIcon className={`size-5 ${isActive ? 'text-primary-foreground' : 'text-primary'}`} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{tab.shortLabel}</p>
                        <p className={`truncate text-xs ${isActive ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                          {tab.description.split(' ').slice(0, 3).join(' ')}...
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="px-3 py-6 text-center text-muted-foreground">
                <Lock className="mx-auto mb-2 size-8 opacity-50" />
                <p className="text-sm">No sections available</p>
              </div>
            )}
          </nav>

          {/* Sidebar Footer */}
          <div className="border-t border-border p-4">
            <div className="rounded-xl border border-primary/20 bg-accent p-4">
              <p className="mb-2 text-xs font-semibold text-primary">Pro Tip</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Use filters and search to quickly find users. Export data for reports.
              </p>
            </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="min-w-0 flex-1">
          {/* Content Body */}
          <div className="p-4 sm:p-6 lg:p-8">{renderContent()}</div>

          {/* Footer */}
          <div className="border-t border-border px-8 py-4 text-center text-xs text-muted-foreground">
            <p>Last updated: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
          </div>
        </main>
      </div>
    </div>
  );
};

export default UserManagementPage;
