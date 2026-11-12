import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { authApi, type PlatformUser } from './lib/api';
import Login from './pages/Login';
import Home from './pages/Home';
import ChangePassword from './pages/ChangePassword';
import Agencies from './pages/Agencies';
import AgencyDetail from './pages/AgencyDetail';
import Staff from './pages/Staff';
import StaffSetup from './pages/StaffSetup';
import Plans from './pages/Plans';
import { useRoute } from './lib/route';

export default function App() {
  const [user, setUser] = useState<PlatformUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [changingPassword, setChangingPassword] = useState(false);
  const route = useRoute();

  // A live session cookie means the person is already signed in.
  useEffect(() => {
    authApi.me()
      .then(({ user: current }) => setUser(current))
      .catch(() => setUser(null))
      .finally(() => setChecking(false));
  }, []);

  if (route.page === 'setup') return <StaffSetup token={route.token} />;

  const signOut = async () => {
    await authApi.logout().catch(() => {});
    setChangingPassword(false);
    setUser(null);
  };

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-label="Loading" />
      </div>
    );
  }
  if (!user) return <Login onSignedIn={setUser} />;

  // The server refuses everything else until a temporary password is replaced; the screen matches.
  if (user.mustChangePassword || changingPassword) {
    return (
      <ChangePassword
        user={user}
        required={Boolean(user.mustChangePassword)}
        onDone={(updated) => { setUser(updated); setChangingPassword(false); }}
        onCancel={user.mustChangePassword ? signOut : () => setChangingPassword(false)}
      />
    );
  }
  const shell = { user, onSignOut: signOut, onChangePassword: () => setChangingPassword(true) };
  if (route.page === 'staff' && user.role === 'platform_admin') return <Staff {...shell} />;
  if (route.page === 'plans') return <Plans {...shell} />;
  if (route.page === 'agency') return <AgencyDetail key={route.id} id={route.id} {...shell} />;
  if (route.page === 'agencies') return <Agencies {...shell} />;
  return <Home {...shell} />;
}
