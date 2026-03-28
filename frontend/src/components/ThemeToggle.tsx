import { Moon, Sun } from 'lucide-react';
import { useThemeStore } from '../store/themeStore';
import { Button } from './ui/button';
import { useEffect } from 'react';

export function ThemeToggle() {
  const { theme, toggleTheme } = useThemeStore();

  // Ensure the theme class is applied correctly on mount in case hydration doesn't match the DOM
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      className="w-9 h-9 text-muted-foreground hover:text-foreground"
      title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
    >
      {theme === 'light' ? (
        <Moon className="h-[1.2rem] w-[1.2rem] transition-all" />
      ) : (
        <Sun className="h-[1.2rem] w-[1.2rem] transition-all" />
      )}
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}
