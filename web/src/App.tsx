import { RouterProvider } from 'react-router-dom';
import { AppProviders } from '@/app/providers';
import { ErrorBoundary } from '@/components/common/error-boundary';
import { router } from '@/router';

export function App(): JSX.Element {
  return (
    <ErrorBoundary>
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>
    </ErrorBoundary>
  );
}
