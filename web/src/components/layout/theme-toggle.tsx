import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/app/theme-context';
import { Button } from '@/components/ui/button';

export function ThemeToggle(): JSX.Element {
  const { resolvedTheme, toggle } = useTheme();
  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme">
      {resolvedTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
