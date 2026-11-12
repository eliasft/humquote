import { useLayoutEffect, useSyncExternalStore } from 'react';
import { useStore } from './store';

const media = window.matchMedia('(prefers-color-scheme: dark)');
const subscribe = (cb: () => void) => { media.addEventListener('change', cb); return () => media.removeEventListener('change', cb); };

// 'light' | 'dark' after applying the user's choice (or the system setting).
export function useResolvedTheme(): 'light' | 'dark' {
  const theme = useStore((s) => s.theme);
  const systemDark = useSyncExternalStore(subscribe, () => media.matches);
  return theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
}

// Layout effect so the class is set before any chart's effect reads the colour tokens.
export function useApplyTheme() {
  const resolved = useResolvedTheme();
  useLayoutEffect(() => { document.documentElement.classList.toggle('dark', resolved === 'dark'); }, [resolved]);
}
