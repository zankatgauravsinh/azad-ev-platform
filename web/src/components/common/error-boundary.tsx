import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * App-level safety net: a render error in any screen shows a recoverable
 * fallback instead of a blank white page. Resets on reload.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surfaced in the browser console for diagnosis; a real deployment would
    // forward this to an error-tracking service (Sentry, etc.).
    console.error('Unhandled UI error:', error, info.componentStack);
  }

  private readonly reload = (): void => {
    window.location.assign('/');
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
          <AlertTriangle className="h-10 w-10 text-destructive" />
          <div>
            <h1 className="text-lg font-semibold">Something went wrong</h1>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              An unexpected error occurred while rendering this screen. Your data is safe — reloading usually fixes it.
            </p>
          </div>
          <Button onClick={this.reload}>Reload the app</Button>
        </div>
      );
    }
    return this.props.children;
  }
}
