import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function DataTable({ head, rows, highlightCol, totalRow, keys, className, stickyHead }: {
  head: ReactNode[];
  rows: ReactNode[][];
  highlightCol?: number;
  totalRow?: number;
  keys?: (string | undefined)[];
  className?: string;
  stickyHead?: boolean;
}) {
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th
                key={i}
                className={cn(
                  'whitespace-nowrap border-b border-border bg-card-2 px-3 py-2 text-xs font-medium text-muted-foreground',
                  i === 0 ? 'text-left' : 'text-right',
                  i === highlightCol && 'bg-accent-soft text-accent-text',
                  stickyHead && 'sticky top-0 z-[1]',
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className={cn('group', ri === totalRow && 'font-semibold')}>
              {r.map((c, ci) => (
                <td
                  key={ci}
                  className={cn(
                    'whitespace-nowrap border-b border-border px-3 py-2 group-last:border-b-0',
                    ci === 0 ? 'text-left text-muted-foreground' : 'tabular text-right',
                    ri === totalRow && 'border-t border-border-strong text-foreground',
                    ci === highlightCol && 'bg-accent-soft',
                  )}
                >
                  {ci === 0 && keys?.[ri] && <span className="mr-2 inline-block size-2.5 rounded-[3px] align-[-1px]" style={{ background: keys[ri] }} />}
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
