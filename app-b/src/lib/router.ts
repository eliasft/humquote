// Hash routing (#/compare, #/market?tab=futures) so GitHub Pages needs no server rewrites.

import { useSyncExternalStore } from 'react';

export type Page = 'quote' | 'compare' | 'saved' | 'market' | 'tariffs';
const PAGES: Page[] = ['quote', 'compare', 'saved', 'market', 'tariffs'];

const subscribe = (cb: () => void) => { window.addEventListener('hashchange', cb); return () => window.removeEventListener('hashchange', cb); };

export function parseHash(hash = window.location.hash): { page: Page; query: string } {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?');
  return { page: (PAGES as string[]).includes(path) ? (path as Page) : 'quote', query };
}

export function useRoute() {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  return parseHash(hash);
}

export const href = (page: Page) => (page === 'quote' ? '#/' : `#/${page}`);

export function navigate(page: Page) {
  window.location.hash = href(page);
  window.scrollTo(0, 0);
}
