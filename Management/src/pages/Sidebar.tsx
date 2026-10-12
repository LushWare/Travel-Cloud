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
  logoUrl?: string;
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

  // Org-configured company name for the sidebar header, falling back to the
  // static config/branding.js defaults while the fetch is in flight or if it
  // fails. The icon is not org-configured: it ships with the app (see
  // getSidebarInfo), so the rail never waits on or depends on a remote logo.
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
    name: orgBranding?.companyName || fallbackInfo.name,
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

  const formatGreeting = () => {
    const hour = currentTime.getHours();
    if (hour < 12) return "Good Morning";
    if (hour < 17) return "Good Afternoon";
    return "Good Evening";
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
        <div className="p-3 border-b border-sidebar-border relative z-10">
          <div className={`flex px-4 ${isExpanded ? 'items-center gap-2' : 'flex-col items-center gap-2'}`}>
            <button
              type="button"
              onClick={openOrgSettings}
              title={canEditOrgSettings ? 'Organization Settings' : brandInfo.name}
              className={
                isExpanded && brandInfo.logoUrl
                  ? `h-11 w-auto min-w-0 max-w-full px-1 rounded-lg flex items-center justify-center transition-colors duration-200 overflow-hidden ${canEditOrgSettings ? 'cursor-pointer hover:bg-sidebar-accent' : 'cursor-default'}`
                  : `${isExpanded ? 'w-11 h-11' : 'w-10 h-10'} rounded-lg flex items-center justify-center font-bold text-sidebar-primary-foreground bg-sidebar-primary transition-colors duration-200 flex-shrink-0 overflow-hidden ${canEditOrgSettings ? 'cursor-pointer hover:bg-sidebar-primary/90' : 'cursor-default'}`
              }
              disabled={!canEditOrgSettings}
            >
              {isExpanded && brandInfo.logoUrl ? (
                <img src={brandInfo.logoUrl} alt={brandInfo.name} className="h-full w-auto max-w-full object-contain" />
              ) : (
                <span className={`${isExpanded ? 'text-base' : 'text-sm'} font-heading font-extrabold tracking-tight`}>
                  {brandInfo.shortName.substring(0, 3)}
                </span>
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
                className={`w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-primary transition-colors duration-150 flex-shrink-0 ${isExpanded ? 'ml-auto' : ''}`}
              >
                {sidebarOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
              </button>
            )}
          </div>
          {/* Company name gets its own row under the logo, and wraps rather than
              truncating: the header must not force the sidebar wider than the
              longest nav label. */}
          {isExpanded && (
            <button
              type="button"
              onClick={openOrgSettings}
              disabled={!canEditOrgSettings}
              className={`mt-2.5 block w-full px-4 text-left ${canEditOrgSettings ? 'cursor-pointer group/brand' : 'cursor-default'}`}
            >
              <h1 className={`font-heading text-sm font-bold leading-snug text-sidebar-foreground ${canEditOrgSettings ? 'group-hover/brand:text-sidebar-primary' : ''}`}>
                {brandInfo.name}
              </h1>
            </button>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto relative z-10">
          <div className={`${isExpanded ? 'px-3' : 'px-1'} mb-4`}>
            {isExpanded && (
              <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Main Menu</p>
            )}
          </div>

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
                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg transition-colors duration-150 text-left group relative overflow-hidden ${active
                  ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent'
                  }`}
              >
                <item.icon className={`w-5 h-5 flex-shrink-0 ${active ? 'text-sidebar-primary-foreground' : 'text-muted-foreground'}`} />

                {isExpanded && (
                  <>
                    <span className={`text-sm font-medium flex-1 ${active ? 'text-sidebar-primary-foreground' : ''}`}>
                      {item.label}
                    </span>
                    <ChevronRight className={`absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 transition-all duration-200 group-hover:translate-x-1 ${active ? 'text-sidebar-primary-foreground/70 opacity-100' : 'text-muted-foreground opacity-0 group-hover:opacity-100'}`} />
                  </>
                )}
              </button>
            );
          })}
        </nav>

        {/* User Profile Section */}
        {isExpanded && user && (
          <div className="p-3 border-t border-sidebar-border relative z-10">
            <div className="rounded-lg bg-sidebar-accent p-2">
              {/* Greeting is its own box inside the card. The identity row below
                  keeps the same inner gutter, so the greeting text, the avatar and
                  the nav icons all sit on the rail's 28px content x (the well's
                  1px border shifts its text by a pixel). */}
              <div className="rounded-md border border-sidebar-border/60 bg-sidebar px-2 py-1.5">
                <p className="text-sm text-muted-foreground">{formatGreeting()}</p>
              </div>
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
                    <Badge variant="secondary">
                      {user.role === 'superAdmin' ? 'Super Admin' : user.role === 'admin' ? 'Admin' : 'Sales Rep'}
                    </Badge>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="p-3 space-y-3 relative z-10">
          <div>
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
            className="w-full justify-start gap-3 px-4 h-10"
          >
            <LogOut className="w-4 h-4" />
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
