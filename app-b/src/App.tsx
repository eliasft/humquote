import { useEffect } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Shell } from './components/Shell';
import { Toaster } from './components/ui/toast';
import { Card, TooltipProvider } from './components/ui/primitives';
import { useMarketData } from './lib/data';
import { parseHash, useRoute } from './lib/router';
import { decodeQuote } from './lib/share';
import { useStore } from './lib/store';
import { useApplyTheme } from './lib/theme';
import { QuotePage } from './pages/QuotePage';
import { ComparePage } from './pages/ComparePage';
import { SavedPage } from './pages/SavedPage';
import { MarketPage } from './pages/MarketPage';

// A shared link (#/?s=QLD&tc=...) loads that quote, then the URL is tidied to #/.
function useSharedQuote() {
  useEffect(() => {
    const { page, query } = parseHash();
    if (page !== 'quote' || !query) return;
    const shared = decodeQuote(query);
    if (!shared) return;
    useStore.setState({ inputs: shared.inputs, state: shared.state });
    history.replaceState(null, '', `${window.location.pathname}#/`);
  }, []);
}

export function App() {
  useApplyTheme();
  useSharedQuote();
  const { page } = useRoute();
  const market = useMarketData();

  return (
    <TooltipProvider>
      <Shell page={page} latestDate={market.status === 'ready' ? market.data.latestDate : undefined}>
        {market.status === 'loading' && (
          <div className="grid min-h-[50vh] place-items-center text-muted-foreground">
            <span className="inline-flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" /> Loading market data…</span>
          </div>
        )}
        {market.status === 'error' && (
          <Card className="flex items-start gap-3 border-danger/40 p-5">
            <AlertTriangle className="mt-0.5 size-5 text-danger" />
            <div>
              <div className="font-medium">Market data unavailable</div>
              <p className="mt-1 text-sm text-muted-foreground">{market.message}. Try reloading the page.</p>
            </div>
          </Card>
        )}
        {market.status === 'ready' && (
          <>
            {page === 'quote' && <QuotePage data={market.data} />}
            {page === 'compare' && <ComparePage data={market.data} />}
            {page === 'saved' && <SavedPage data={market.data} />}
            {page === 'market' && <MarketPage data={market.data} />}
          </>
        )}
      </Shell>
      <Toaster />
    </TooltipProvider>
  );
}
