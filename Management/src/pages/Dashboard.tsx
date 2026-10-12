/**
 * Dashboard Page
 * 
 * Entry point for the dashboard. Uses the DashboardContainer component
 * which handles API data fetching and role-based content adaptation.
 * 
 * This page component has been simplified to use the feature-based architecture.
 * All functionality is organized in: src/features/dashboard/
 */

import { DashboardContainer } from '../features/dashboard';

const Dashboard = () => {
  return <DashboardContainer />;
};

export default Dashboard;