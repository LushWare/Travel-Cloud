import { useState, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import {
  Menu, X, Home, Users, MapPin, DollarSign, User, LogOut,
  BarChart3, Briefcase, ChevronRight, PanelLeftClose, PanelLeftOpen, Sparkles, Plane, Hotel, Settings
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { usePermission } from "../contexts/PermissionContext";
import toast from '@/lib/toast';
import { getSidebarInfo } from "../config/branding";
import { adminAPI } from "../services/api";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import AppearanceToggle from "../components/AppearanceToggle";

// Initials for the sidebar icon when no explicit short name is configured —
// first letter of the first two words (e.g. "Lush Travel" -> "LT"), or the
// first two letters of a single-word name.
const deriveInitials = (name: string): string => {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  if (words.length === 1) return words[0].substring(0, 2).toUpperCase();
  return "";
};

interface OrgBranding {
  companyName?: string;
  companyShortName?: string;
}

interface NavItem {
  icon: LucideIcon;
  label: string;
  path: string;
  requiredPermission?: string | null;
  allowedRoles?: string[];
  requiresAnyPermission?: string[];
  customCheck?: (
    userRole: string | undefined,
    userIsSuperAdmin: boolean | undefined,
    hasPermission: (perm: string) => boolean
  ) => boolean;
}

const Sidebar = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout, user } = useAuth();
  const permission = usePermission();
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const stored = window.localStorage.getItem("management-sidebar-open");
    return stored === null ? true : stored === "true";
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isMobile, setIsMobile] = useState(false);
  const [orgBranding, setOrgBranding] = useState<OrgBranding | null>(null);

  // Load organization branding for initials while keeping the sidebar label app-branded.
  useEffect(() => {
    let cancelled = false;
    adminAPI.getOrganizationBranding()
      .then((res: { status: string; data?: { branding?: OrgBranding } }) => {
        if (!cancelled && res.status === 'success' && res.data?.branding) {
          setOrgBranding(res.data.branding);
        }
      })
      .catch(() => {}); // keep the static fallback
    return () => { cancelled = true; };
  }, []);

  const fallbackInfo = getSidebarInfo();
  const brandInfo = {
    name: 'Travel Cloud',
    // Prefer an explicit short name; otherwise derive initials from the real
    // org-configured company name rather than falling through to the static
    // placeholder default in config/branding.js.
    shortName:
      orgBranding?.companyShortName ||
      (orgBranding?.companyName ? deriveInitials(orgBranding.companyName) : fallbackInfo.shortName),
    logoUrl: fallbackInfo.logoUrl,
  };
  const canEditOrgSettings = user?.isSuperAdmin || user?.role === 'admin' || user?.role === 'superAdmin';

  // Detect mobile viewport
  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      // Raw setter — must not go through toggleSidebar, which would
      // overwrite the desktop-persisted preference in localStorage.
      if (mobile) setSidebarOpen(false);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Close mobile sidebar on route change
  useEffect(() => {
    if (isMobile) setMobileOpen(false);
  }, [location.pathname, isMobile]);

  // Persists the collapsed/expanded choice so it survives reloads.
  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => {
      const next = !prev;
      window.localStorage.setItem("management-sidebar-open", String(next));
      return next;
    });
  }, []);

  // Ctrl/Cmd+B toggles the sidebar, matching VS Code/Linear convention.
  useEffect(() => {
    if (isMobile) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isMobile, toggleSidebar]);

  // Update time every minute
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const navigationItems: NavItem[] = [
    { icon: Home, label: "Dashboard", path: "/", requiredPermission: null, allowedRoles: ["admin", "superAdmin"] },
    { icon: Users, label: "Leads", path: "/leads", requiredPermission: null, allowedRoles: ["salesRep", "admin"], requiresAnyPermission: ["manage_leads"] },
    {
      icon: MapPin,
      label: "Packages",
      path: "/packages",
      requiredPermission: null,
      customCheck: (userRole, userIsSuperAdmin, hasPermission) => {
        if (userRole === 'superAdmin' && userIsSuperAdmin === true) return true;
        if (userRole === 'salesRep') return true;
        if (userRole === 'admin') return hasPermission('manage_packages');
        return false;
      }
    },
    { icon: Plane, label: "Flights", path: "/flights", requiredPermission: null, allowedRoles: ["salesRep", "admin", "superAdmin"] },
    { icon: Hotel, label: "Hotels", path: "/hotels", requiredPermission: null, allowedRoles: ["salesRep", "admin", "superAdmin"] },
    { icon: DollarSign, label: "Billing", path: "/billing", requiredPermission: "manage_billing" },
    { icon: BarChart3, label: "Analytics", path: "/analytics", requiredPermission: "view_reports" },
    { icon: Sparkles, label: "AI Insights", path: "/ai-insights", requiredPermission: null, allowedRoles: ["salesRep", "admin", "superAdmin"] },
    { icon: User, label: "Users", path: "/users", requiredPermission: null, requiresAnyPermission: ["manage_users", "manage_sales_reps", "manage_vendors", "manage_admins"] },
    {
      icon: Briefcase,
      label: "Career",
      path: "/career",
      requiredPermission: null,
      customCheck: (userRole) => userRole === 'superAdmin'
    },
    {
      icon: Settings,
      label: "Settings",
      path: "/settings",
      requiredPermission: null,
      allowedRoles: ["admin", "superAdmin"],
    },
  ];

  // Filter navigation items based on permissions and roles
  const accessibleItems = navigationItems.filter((item) => {
    if (item.customCheck) {
      return item.customCheck(user?.role, user?.isSuperAdmin, (perm: string) => permission.hasPermission(perm));
    }
    if (item.allowedRoles) {
      return item.allowedRoles.includes(user?.role);
    }
    if (!item.requiredPermission && !item.requiresAnyPermission) {
      return true;
    }
    if (item.requiredPermission) {
      return permission.hasPermission(item.requiredPermission);
    }
    if (item.requiresAnyPermission) {
      return item.requiresAnyPermission.some((perm) => permission.hasPermission(perm));
    }
    return false;
  });

  const isActive = (path: string) => location.pathname === path;

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await logout();
      navigate("/login");
    } catch (error) {
      console.error("Logout failed:", error);
      toast.error("Logout failed");
    } finally {
      setIsLoggingOut(false);
    }
  };

  // Toggle for mobile
  const toggleMobile = useCallback(() => setMobileOpen(prev => !prev), []);

  // Both brand surfaces (the logo tile and the company name) open Org Settings
  // for the roles allowed to edit it — one gate, not two copies.
  const openOrgSettings = useCallback(() => {
    if (!canEditOrgSettings) return;
    navigate('/settings');
    if (isMobile) setMobileOpen(false);
  }, [canEditOrgSettings, navigate, isMobile]);

  // w-56 (224px) is set by the user card, not by the nav: the card's identity row
  // has ~167px of room and the 40px avatar + 8px gap + the 111px "Super Admin"
  // role row already spend 159 of them. Nav labels clear it with room to spare,
  // so nothing in the rail may grow wider.
  const sidebarContent = (isExpanded: boolean) => (
    <div className={`${isExpanded ? "w-56" : "w-20"} h-full relative flex-shrink-0 transition-layout`}>
      <div className="h-full w-full flex flex-col relative overflow-hidden bg-sidebar border-r border-sidebar-border">

        {/* Header / Brand */}
        <div className={`${isExpanded ? 'p-3' : 'p-2'} border-b border-sidebar-border relative z-10`}>
          <div className={`flex px-2 ${isExpanded ? 'items-center gap-2' : 'flex-col items-center gap-3'}`}>
            <button
              type="button"
              onClick={openOrgSettings}
              title={canEditOrgSettings ? 'Organization Settings' : 'Company logo'}
              className={`flex min-w-0 items-center overflow-hidden rounded-lg transition-colors duration-200 ${isExpanded ? 'h-10 flex-1 justify-start gap-2 px-1' : 'h-10 w-10 justify-center'} ${canEditOrgSettings ? 'cursor-pointer hover:bg-sidebar-accent' : 'cursor-default'}`}
              disabled={!canEditOrgSettings}
            >
              {brandInfo.logoUrl ? (
                <img src={brandInfo.logoUrl} alt={brandInfo.name} className="h-9 w-9 shrink-0 object-contain" />
              ) : (
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary font-heading text-sm font-extrabold text-sidebar-primary-foreground">
                  {brandInfo.shortName.substring(0, 3)}
                </span>
              )}
              {isExpanded && (
                <h1 className="min-w-0 flex-1 truncate text-left font-heading text-sm font-semibold text-sidebar-foreground">
                  {brandInfo.name}
                </h1>
              )}
            </button>
            {/* Close button on mobile */}
            {isMobile && isExpanded && (
              <button onClick={() => setMobileOpen(false)} className="p-2 rounded-lg hover:bg-sidebar-accent text-muted-foreground ml-auto">
                <X className="w-5 h-5" />
              </button>
            )}
            {/* Collapse/expand trigger — sits in the header row so it never
                floats outside the sidebar's own boundary. Stacks below the
                logo when collapsed since w-20 has no room beside it. */}
            {!isMobile && (
              <button
                type="button"
                onClick={toggleSidebar}
                title={sidebarOpen ? "Collapse sidebar (Ctrl+B)" : "Expand sidebar (Ctrl+B)"}
                aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
                className={`${isExpanded ? 'h-8 w-8' : 'h-10 w-10'} flex items-center justify-center rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-primary transition-colors duration-150 flex-shrink-0 ${isExpanded ? 'ml-auto' : ''}`}
              >
                {sidebarOpen ? <PanelLeftClose className={isExpanded ? 'h-4 w-4' : 'h-5 w-5'} /> : <PanelLeftOpen className={isExpanded ? 'h-4 w-4' : 'h-5 w-5'} />}
              </button>
            )}
          </div>
        </div>

        {/* Navigation */}
        <nav className={`flex-1 overflow-y-auto relative z-10 ${isExpanded ? 'p-3 space-y-1' : 'p-2 space-y-0.5'}`}>
          {accessibleItems.map((item) => {
            const active = isActive(item.path);

            return (
              <button
                key={item.path}
                onClick={() => {
                  navigate(item.path);
                  if (isMobile) setMobileOpen(false);
                }}
                title={item.label}
                aria-label={item.label}
                className={`flex items-center rounded-lg transition-colors duration-150 group relative overflow-hidden ${isExpanded ? 'w-full gap-3 px-4 py-2.5 text-left' : 'mx-auto h-9 w-9 justify-center p-0'} ${active
                  ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent'
                  }`}
              >
                <item.icon className={`${isExpanded ? 'h-5 w-5' : 'h-[18px] w-[18px]'} flex-shrink-0 ${active ? 'text-sidebar-primary-foreground' : 'text-muted-foreground'}`} />

                {isExpanded && (
                  <>
                    <span className={`text-[13px] font-medium flex-1 ${active ? 'text-sidebar-primary-foreground' : ''}`}>
                      {item.label}
                    </span>
                    <ChevronRight className={`absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 transition-all duration-200 group-hover:translate-x-1 ${active ? 'text-sidebar-primary-foreground/70 opacity-100' : 'text-muted-foreground opacity-0 group-hover:opacity-100'}`} />
                  </>
                )}
              </button>
            );
          })}
        </nav>

        {!isExpanded && !isMobile && (
          <div className="border-t border-sidebar-border px-2 py-2">
            <button
              type="button"
              onClick={toggleSidebar}
              title="Expand sidebar"
              aria-label="Expand sidebar from navigation"
              className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-primary"
            >
              <PanelLeftOpen className="h-5 w-5" />
            </button>
          </div>
        )}

        {/* User Profile Section */}
        {isExpanded && user && (
          <div className="p-3 border-t border-sidebar-border relative z-10">
            <div className="rounded-lg bg-sidebar-accent p-2">
              <div className="mt-2 flex items-center gap-2 px-2">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center text-sidebar-primary-foreground bg-sidebar-primary font-semibold flex-shrink-0">
                  {user.name?.charAt(0)?.toUpperCase() || 'U'}
                </div>
                {/* Name and role share one column so the role reads as part of
                    the identity, not as a second, unrelated row in the card. */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-sidebar-foreground truncate">{user.name}</p>
                  <div className="mt-1 flex items-center gap-1">
                    {user.role === 'superAdmin' && <Sparkles className="w-4 h-4 flex-shrink-0 text-sidebar-primary" />}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className={`relative z-10 ${isExpanded ? 'p-3 space-y-3' : 'flex flex-col items-center gap-1 p-2'}`}>
          <div className={isExpanded ? undefined : 'w-9'}>
            {isExpanded && (
              <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2 px-1">Appearance</p>
            )}
            <AppearanceToggle collapsed={!isExpanded} />
          </div>
          <Button
            onClick={handleLogout}
            disabled={isLoggingOut}
            variant="destructive"
            title={isLoggingOut ? "Signing out..." : "Sign Out"}
            aria-label={isLoggingOut ? "Signing out..." : "Sign Out"}
            className={isExpanded ? 'h-10 w-full justify-start gap-3 px-4' : 'h-9 w-9 justify-center p-0'}
          >
            <LogOut className={isExpanded ? 'h-4 w-4' : 'h-[18px] w-[18px]'} />
            {isExpanded && <span>{isLoggingOut ? "Signing out..." : "Sign Out"}</span>}
          </Button>
        </div>
      </div>
    </div>
  );

  // Mobile: render hamburger button + overlay drawer
  if (isMobile) {
    return (
      <>
        {/* Mobile Hamburger Button - Fixed top-left */}
        {!mobileOpen && (
          <button
            onClick={toggleMobile}
            className="fixed top-3 left-3 z-50 p-2.5 rounded-lg bg-card shadow-card border border-border text-muted-foreground hover:text-primary transition-colors"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>
        )}

        {/* Overlay */}
        {mobileOpen && (
          <div
            className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40 transition-opacity"
            onClick={() => setMobileOpen(false)}
          />
        )}

        {/* Sidebar Drawer */}
        <div
          className={`fixed top-0 left-0 h-full z-50 transform transition-transform duration-300 ease-in-out ${
            mobileOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          {sidebarContent(true)}
        </div>
      </>
    );
  }

  // Desktop: render inline sidebar
  return sidebarContent(sidebarOpen);
};

export default Sidebar;
