import { useState } from 'react';
import { ArrowRight, Bookmark, Columns3, Copy, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/Shell';
import { Button, Card, Dialog, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, TextInput } from '@/components/ui/primitives';
import { toast } from '@/components/ui/toast';
import { calculateBulkPrices } from '@/core/calc';
import { quotePeriods } from '@/core/analysis';
import { monthLabel } from '@/core/periods';
import { tariffLabel } from '@/core/tariffs';
import type { MarketData } from '@/lib/data';
import { money, num, shortDate, signed } from '@/lib/format';
import { navigate } from '@/lib/router';
import { useStore, type SavedQuote } from '@/lib/store';
import { cn } from '@/lib/cn';

function RenameDialog({ quote, onClose }: { quote: SavedQuote | null; onClose: () => void }) {
  const renameQuote = useStore((s) => s.renameQuote);
  return (
    <Dialog open={!!quote} onOpenChange={(o) => { if (!o) onClose(); }} title="Rename quote">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const name = new FormData(e.currentTarget).get('name')?.toString().trim();
          if (quote && name) renameQuote(quote.id, name);
          onClose();
        }}
      >
        <TextInput name="name" autoFocus defaultValue={quote?.name} aria-label="Quote name" />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary">Rename</Button>
        </div>
      </form>
    </Dialog>
  );
}

function DeleteDialog({ quote, onClose }: { quote: SavedQuote | null; onClose: () => void }) {
  const deleteQuote = useStore((s) => s.deleteQuote);
  return (
    <Dialog open={!!quote} onOpenChange={(o) => { if (!o) onClose(); }} title="Delete quote?" description={quote ? `“${quote.name}” will be removed from this browser. This can't be undone.` : undefined}>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" className="bg-danger text-white" onClick={() => { if (quote) deleteQuote(quote.id); onClose(); toast('Quote deleted'); }}>
          <Trash2 /> Delete
        </Button>
      </div>
    </Dialog>
  );
}

export function SavedPage({ data }: { data: MarketData }) {
  const { saved, compareIds, toggleCompare, saveQuote } = useStore();
  const [renaming, setRenaming] = useState<SavedQuote | null>(null);
  const [deleting, setDeleting] = useState<SavedQuote | null>(null);

  const open = (q: SavedQuote) => {
    useStore.setState({ inputs: q.inputs, state: q.state });
    navigate('quote');
    toast(`Opened “${q.name}”`);
  };

  return (
    <>
      <PageHeader
        title="Saved quotes"
        description="Stored in this browser. Prices are recalculated with the latest ASX data."
        actions={compareIds.length > 0 && <Button variant="primary" onClick={() => navigate('compare')}><Columns3 /> Compare {compareIds.length}</Button>}
      />

      {!saved.length ? (
        <Card className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <span className="grid size-11 place-items-center rounded-full bg-muted"><Bookmark className="size-5 text-muted-foreground" /></span>
          <div>
            <div className="font-medium">No saved quotes yet</div>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">Build a quote and press Save to keep it here. You can reopen it, re-price it against new data, or compare it with others.</p>
          </div>
          <Button onClick={() => navigate('quote')}>Go to Quote <ArrowRight /></Button>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {saved.map((q) => {
            const periods = quotePeriods(data.curve, q.inputs);
            const now = calculateBulkPrices(periods, q.inputs, q.state).bulkPrice;
            const change = now - q.priceAtSave;
            const selected = compareIds.includes(q.id);
            return (
              <Card key={q.id} className={cn('flex flex-col', selected && 'ring-2 ring-accent')}>
                <div className="flex items-start justify-between gap-2 px-4 pt-4">
                  <div className="min-w-0">
                    <div className="truncate font-semibold" title={q.name}>{q.name}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">Saved {shortDate(q.createdAt.slice(0, 10))} · {q.state} · {num(q.inputs.totalConsumption, 0)} kWh</div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">{tariffLabel(q.inputs.tariffId)} · supply from {periods[0] ? monthLabel(periods[0].start) : '—'}</div>
                  </div>
                  <Menu>
                    <MenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`Actions for ${q.name}`}><MoreHorizontal /></Button></MenuTrigger>
                    <MenuContent>
                      <MenuItem onSelect={() => open(q)}><ArrowRight /> Open in Quote</MenuItem>
                      <MenuItem onSelect={() => setRenaming(q)}><Pencil /> Rename</MenuItem>
                      <MenuItem onSelect={() => { saveQuote({ ...q, name: `${q.name} (copy)` }); toast('Quote duplicated'); }}><Copy /> Duplicate</MenuItem>
                      <MenuSeparator />
                      <MenuItem className="text-danger [&_svg]:text-danger" onSelect={() => setDeleting(q)}><Trash2 /> Delete</MenuItem>
                    </MenuContent>
                  </Menu>
                </div>
                <div className="flex items-end justify-between gap-3 px-4 py-4">
                  <div>
                    <div className="text-xs text-muted-foreground">Price now</div>
                    <div className="tabular text-2xl font-semibold tracking-tight">{money(now, 4)}<span className="ml-1 text-sm font-medium text-muted-foreground">/kWh</span></div>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <div>When saved ({shortDate(q.dataDate)})</div>
                    <div className="tabular text-sm text-foreground">{money(q.priceAtSave, 4)} <span className="text-muted-foreground">({signed(change, 4, '$')})</span></div>
                  </div>
                </div>
                <div className="mt-auto flex gap-2 border-t border-border p-3">
                  <Button size="sm" className="flex-1" onClick={() => open(q)}>Open</Button>
                  <Button size="sm" className="flex-1" variant={selected ? 'accent' : 'outline'} onClick={() => toggleCompare(q.id)} aria-pressed={selected}>
                    <Columns3 /> {selected ? 'Comparing' : 'Compare'}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <RenameDialog quote={renaming} onClose={() => setRenaming(null)} />
      <DeleteDialog quote={deleting} onClose={() => setDeleting(null)} />
    </>
  );
}
