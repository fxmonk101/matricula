'use client';

import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';

type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'ge-theme';

/**
 * Apply a theme choice to the document.
 *
 * Exported so the inline boot script and this component agree on exactly one
 * definition of what each choice means. Two copies of this rule is how a page
 * ends up flashing the wrong theme on one route and not another.
 */
export function applyTheme(theme: Theme): void {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = theme === 'dark' || (theme === 'system' && prefersDark);
  document.documentElement.classList.toggle('dark', dark);
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system');

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
    if (stored) setTheme(stored);
  }, []);

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(STORAGE_KEY, theme);

    // "System" must keep tracking the system. Without this listener a reader
    // whose machine switches to dark at sunset would sit on the light theme
    // until they reloaded.
    if (theme !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [theme]);

  const options: { value: Theme; label: string; icon: React.ReactNode }[] = [
    {
      value: 'light',
      label: 'Light',
      icon: (
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5" aria-hidden>
          <path d="M10 4a1 1 0 0 1-1-1V2a1 1 0 1 1 2 0v1a1 1 0 0 1-1 1Zm0 12a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0v-1a1 1 0 0 1 1-1Zm6-6a1 1 0 0 1 1-1h1a1 1 0 1 1 0 2h-1a1 1 0 0 1-1-1ZM2 10a1 1 0 0 1 1-1h1a1 1 0 1 1 0 2H3a1 1 0 0 1-1-1Zm12.95-4.95a1 1 0 0 1 0-1.42l.7-.7a1 1 0 1 1 1.42 1.42l-.7.7a1 1 0 0 1-1.42 0ZM3.93 16.07a1 1 0 0 1 0-1.42l.7-.7a1 1 0 1 1 1.42 1.42l-.7.7a1 1 0 0 1-1.42 0Zm12.14 0a1 1 0 0 1-1.42 0l-.7-.7a1 1 0 1 1 1.42-1.42l.7.7a1 1 0 0 1 0 1.42ZM5.05 5.05a1 1 0 0 1-1.42 0l-.7-.7a1 1 0 0 1 1.42-1.42l.7.7a1 1 0 0 1 0 1.42ZM10 6a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" />
        </svg>
      ),
    },
    {
      value: 'system',
      label: 'System',
      icon: (
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5" aria-hidden>
          <path d="M3 4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-3v2h2a1 1 0 1 1 0 2H6a1 1 0 1 1 0-2h2v-2H5a2 2 0 0 1-2-2V4Z" />
        </svg>
      ),
    },
    {
      value: 'dark',
      label: 'Dark',
      icon: (
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5" aria-hidden>
          <path d="M17.3 12.8A7.5 7.5 0 0 1 7.2 2.7a7.5 7.5 0 1 0 10.1 10.1Z" />
        </svg>
      ),
    },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className="inline-flex rounded-lg bg-slate-100 p-0.5"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={theme === o.value}
          title={o.label}
          onClick={() => setTheme(o.value)}
          className={cn(
            'grid h-6 w-7 place-items-center rounded-md transition-colors',
            theme === o.value
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-400 hover:text-slate-600',
          )}
        >
          {o.icon}
          <span className="sr-only">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * The boot script, inlined into <head> before first paint.
 *
 * Without it the page renders light, then this component mounts and switches to
 * dark — a white flash on every navigation for anyone using the dark theme.
 * It has to be a blocking inline script for that reason; a deferred one runs
 * too late to help.
 *
 * Wrapped in try/catch because `localStorage` throws outright in a browser
 * configured to block site data, and a theme preference is not worth taking
 * the whole page down for.
 */
export const THEME_BOOT_SCRIPT = `
(function(){try{
  var t = localStorage.getItem('${STORAGE_KEY}') || 'system';
  var d = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (d) document.documentElement.classList.add('dark');
}catch(e){}})();
`.trim();
