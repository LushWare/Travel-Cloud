import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import HomePage from './pages/HomePage';
import DestinationsPage from './pages/DestinationsPage';
import PackagesPage from './pages/PackagesPage';
import PackageDetailsPage from './pages/PackageDetailsPage';
import CustomizePackagePage from './pages/CustomizePackagePage';
import AboutPage from './pages/AboutPage';
import ContactPage from './pages/ContactPage';
import PlanYourTripPage from './pages/PlanYourTripPage';
import NavBar from './components/NavBar';
import ScrollToTop from './components/shared/ScrollToTop';
import CtaFooter from './components/Home/CTA';
import Footer from './components/Footer';
import AuthPage from './pages/AuthPage';
import MyAccountPage from './pages/MyAccountPage';
import CareerPage from './pages/CareerPage';
import { AuthProvider } from './contexts/AuthContext';
import { AssistantCapabilityProvider } from './features/assistant/capabilities/AssistantCapabilityProvider';
import AssistantWidget from './features/assistant/components/AssistantWidget';
import FloatingActionStack from './components/shared/floating-actions/FloatingActionStack';

function App() {
  return (
    <Router>
      <ScrollToTop />
      <AuthProvider>
        <AssistantCapabilityProvider>
          <NavBar />
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/destinations" element={<DestinationsPage />} />
            <Route path="/packages" element={<PackagesPage />} />
            <Route path="/packages/:id" element={<PackageDetailsPage />} />
            <Route path="/package/:id/customize" element={<CustomizePackagePage />} />
            {/* <Route path="/package/:id" element={<PackageDetailsPage />} /> */}
            <Route path="/about" element={<AboutPage />} />
            <Route path="/contact" element={<ContactPage />} />
            <Route path="/planner" element={<PlanYourTripPage />} />
            <Route path="/career" element={<CareerPage />} />
            <Route path="/login" element={<AuthPage />} />
            <Route path="/register" element={<AuthPage />} />
            <Route path="/my-account" element={<MyAccountPage />} />
            <Route path="/reset-password/:token" element={<AuthPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <CtaFooter />
          <Footer />
          <FloatingActionStack />
          <AssistantWidget />
        </AssistantCapabilityProvider>
      </AuthProvider>
    </Router>
  );
}

export default App;
