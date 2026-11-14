import type { ReactNode } from 'react';
import { Bookmark, Calculator, Columns3, LineChart, Monitor, Moon, ReceiptText, Sun, Zap } from 'lucide-react';
import { href, type Page } from '@/lib/router';
import { useStore, type Theme } from '@/lib/store';
import { daysBetween, shortDate } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Segmented } from './ui/primitives';

const NAV: { page: Page; label: string; icon: typeof Calculator }[] = [
  { page: 'quote', label: 'Quote', icon: Calculator },
  { page: 'compare', label: 'Compare', icon: Columns3 },
  { page: 'saved', label: 'Saved', icon: Bookmark },
  { page: 'market', label: 'Market', icon: LineChart },
  { page: 'tariffs', label: 'Tariffs', icon: ReceiptText },
];

const STALE_AFTER_DAYS = 4;

function Logo() {
  return (
    <a href="#/" className="flex items-center gap-2.5" aria-label="Bulk Quote home">
      <span className="grid size-8 place-items-center rounded-lg bg-accent text-accent-foreground shadow-card">
        <Zap className="size-4.5" fill="currentColor" strokeWidth={1.5} />
      </span>
      <span className="leading-tight">
        <span className="block text-[15px] font-semibold tracking-tight">Bulk Quote</span>
        <span className="block text-xs text-muted-foreground">Electricity pricing</span>
      </span>
    </a>
  );
}

export function DataStatus({ latestDate, compact }: { latestDate?: string; compact?: boolean }) {
  if (!latestDate) return null;
  const stale = daysBetween(latestDate, new Date()) > STALE_AFTER_DAYS;
  return (
    <div
      className={cn('flex items-center gap-2 text-[13px]', stale ? 'font-medium text-warning-text' : 'text-muted-foreground')}
      title={stale ? 'The daily data update may have failed: prices are more than 4 days old.' : 'ASX settlement prices, updated each weekday after market close.'}
    >
      <span className={cn('size-2 rounded-full', stale ? 'bg-warning' : 'bg-good')} aria-hidden />
      {stale && <span aria-hidden>⚠</span>}
      <span>{stale ? 'Prices may be out of date' : compact ? 'ASX' : 'ASX data'} · {shortDate(latestDate)}</span>
    </div>
  );
}

function ThemeSwitch({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  return (
    <Segmented<Theme>
      label="Theme"
      size={size}
      value={theme}
      onChange={setTheme}
      options={[
        { value: 'system', label: <Monitor className="mx-auto size-4" aria-label="System theme" /> },
        { value: 'light', label: <Sun className="mx-auto size-4" aria-label="Light theme" /> },
        { value: 'dark', label: <Moon className="mx-auto size-4" aria-label="Dark theme" /> },
      ]}
    />
  );
}

export function Shell({ page, latestDate, children }: { page: Page; latestDate?: string; children: ReactNode }) {
  const savedCount = useStore((s) => s.saved.length);
  return (
    <div className="min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-border bg-card px-4 py-5 lg:flex">
        <Logo />
        <nav className="mt-8 flex flex-col gap-0.5" aria-label="Pages">
          {NAV.map(({ page: p, label, icon: Icon }) => (
            <a
              key={p}
              href={href(p)}
              aria-current={p === page ? 'page' : undefined}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                p === page ? 'bg-accent-soft text-accent-text' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Icon className="size-4.5" />
              {label}
              {p === 'saved' && savedCount > 0 && (
                <span className="ml-auto rounded-full bg-muted px-2 text-xs tabular text-muted-foreground">{savedCount}</span>
              )}
            </a>
          ))}
        </nav>
        <div className="mt-auto space-y-4">
          <div className="rounded-xl border border-border bg-card-2 p-3">
            <div className="text-xs font-medium uppercase tracking-wide text-subtle">Market data</div>
            <div className="mt-1.5"><DataStatus latestDate={latestDate} /></div>
            <p className="mt-1.5 text-xs text-subtle">ASX base futures settlements, updated each weekday after close.</p>
          </div>
          <ThemeSwitch />
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="no-print sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border bg-card/90 px-4 backdrop-blur lg:hidden">
        <Logo />
        <div className="flex items-center gap-3">
          <span className="hidden sm:block"><DataStatus latestDate={latestDate} compact /></span>
          <ThemeSwitch size="sm" />
        </div>
      </header>

      <main className="lg:pl-60">
        <div className="mx-auto max-w-[1280px] px-4 pb-28 pt-5 sm:px-6 lg:px-8 lg:pb-12 lg:pt-8">{children}</div>
      </main>

      {/* Mobile bottom nav */}
      <nav className="no-print fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" aria-label="Pages">
        {NAV.map(({ page: p, label, icon: Icon }) => (
          <a
            key={p}
            href={href(p)}
            aria-current={p === page ? 'page' : undefined}
            className={cn('flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium', p === page ? 'text-accent-text' : 'text-muted-foreground')}
          >
            <Icon className="size-5" />
            {label}
          </a>
        ))}
      </nav>
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="no-print mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">{title}</h1>
        {description && <p className="mt-1 text-[15px] text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
