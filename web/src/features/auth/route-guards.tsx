import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './auth-context';
import { FullPageLoader } from '@/components/common/full-page-loader';

/** Blocks unauthenticated users; renders children once a session is confirmed. */
export function RequireAuth(): JSX.Element {
  const { status } = useAuth();
  if (status === 'loading') return <FullPageLoader />;
  if (status === 'unauthenticated') return <Navigate to="/login" replace />;
  return <Outlet />;
}

/** Keeps authenticated users out of the login page. */
export function RequireGuest(): JSX.Element {
  const { status } = useAuth();
  if (status === 'loading') return <FullPageLoader />;
  if (status === 'authenticated') return <Navigate to="/" replace />;
  return <Outlet />;
}
