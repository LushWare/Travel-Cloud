import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AuthProvider } from './contexts/AuthContext';
import { PermissionProvider } from './contexts/PermissionContext';
import { ThemeProvider } from './contexts/ThemeContext';
import './index.css';
import axios from 'axios';
import { installAxiosAuth } from './lib/authFetch';

installAxiosAuth(axios);

// Suppress React DevTools message in development
if (process.env.NODE_ENV === 'development') {
  const noop = () => {};
  if (typeof window !== 'undefined' && !window.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      isCommitFiberRoot: noop,
      onCommitFiberRoot: noop,
      onCommitFiberUnmount: noop,
      onPostCommitFiberRoot: noop,
      scheduleHook: noop,
      scheduleFiberRoot: noop,
      setResourceSortingPriority: noop,
      registerInternalModuleStart: noop,
      registerInternalModuleStop: noop,
      registerLog: noop,
    };
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <PermissionProvider>
          <App />
        </PermissionProvider>
      </AuthProvider>
    </ThemeProvider>
  </React.StrictMode>
);
