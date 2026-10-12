import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "@/components/ui/toast";
import Sidebar from "./pages/Sidebar";
import Analytics from "./pages/Analytics";
import LeadManagement from "./pages/LeadManagement";
import ItineraryGeneration from "./pages/ItineraryGeneration";
import FlightSearch from "./pages/FlightSearch";
import HotelSearch from "./pages/HotelSearch";
import BillingInvoicing from "./pages/BillingInvoicing";
import UserManagement from "./pages/UserManagement";
import CareerManagement from "./pages/CareerManagement";
import OrganizationSettings from "./pages/OrganizationSettings";
import AIInsights from "./pages/AIInsights";
import Login from "./pages/Login";
import SalesRepLogin from "./pages/SalesRepLogin";
import SalesRepLoginOTP from "./pages/SalesRepLoginOTP";
import ResetPassword from "./pages/ResetPassword";
import ProtectedRoute from "./components/ProtectedRoute";
import HomeRoute from "./components/HomeRoute";
import { useAuth } from "./contexts/AuthContext";
import { NotificationProvider } from "./features/notifications/NotificationProvider";

function AppContent() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="mb-4">
            <svg
              className="animate-spin h-12 w-12 text-blue-600 mx-auto"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              ></circle>
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              ></path>
            </svg>
          </div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/sales-rep-login" element={<SalesRepLogin />} />
      <Route path="/sales-rep-login-otp" element={<SalesRepLoginOTP />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      
      <Route
        path="/*"
        element={
          isAuthenticated ? (
            <NotificationProvider>
            <div className="flex h-screen bg-background">
              <Sidebar />
              <div className="flex-1 overflow-auto min-w-0">
                <Routes>
                  <Route path="/" element={<HomeRoute />} />
                  <Route path="/analytics" element={<Analytics />} />
                  <Route path="/leads" element={<LeadManagement />} />
                  <Route path="/packages" element={<ItineraryGeneration />} />
                  <Route path="/flights" element={<FlightSearch />} />
                  <Route path="/hotels" element={<HotelSearch />} />
                  <Route path="/billing" element={<BillingInvoicing />} />
                  <Route path="/ai-insights" element={<AIInsights />} />
                  <Route
                    path="/users"
                    element={
                      <ProtectedRoute requiredRoles={["admin", "superAdmin"]}>
                        <UserManagement />
                      </ProtectedRoute>
                    }
                  />
                  {/* Admin-gated to match career-service: /vacancies/admin/all
                      sits behind the admin role, so a non-admin reaching this
                      page would render a list that 403s. */}
                  <Route
                    path="/career"
                    element={
                      <ProtectedRoute requiredRoles={["admin", "superAdmin"]}>
                        <CareerManagement />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/settings"
                    element={
                      <ProtectedRoute requiredRoles={["admin", "superAdmin"]}>
                        <OrganizationSettings />
                      </ProtectedRoute>
                    }
                  />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </div>
            </div>
            </NotificationProvider>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
    </Routes>
  );
}

function App() {
  return (
    <>
      <Router 
        future={{ 
          v7_startTransition: true,
          v7_relativeSplatPath: true 
        }}
      >
        <AppContent />
      </Router>
      <Toaster timeout={4000} />
    </>
  );
}

export default App;
