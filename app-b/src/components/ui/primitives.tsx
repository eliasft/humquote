// Small UI kit in the shadcn/ui style: Tailwind classes over Radix primitives.

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

// ── Button ────────────────────────────────────────────────────────────────────

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 cursor-pointer',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:opacity-90',
        accent: 'bg-accent text-accent-foreground hover:opacity-90',
        outline: 'border border-border-strong bg-card hover:bg-muted',
        ghost: 'text-muted-foreground hover:bg-muted hover:text-foreground',
        danger: 'text-danger hover:bg-danger-soft',
      },
      size: {
        sm: 'h-8 px-2.5 text-[13px]',
        md: 'h-9 px-3.5',
        lg: 'h-10 px-4',
        icon: 'size-9',
        'icon-sm': 'size-8',
      },
    },
    defaultVariants: { variant: 'outline', size: 'md' },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild, ...props }, ref) => {
  const Comp = asChild ? Slot : 'button';
  return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
});
Button.displayName = 'Button';

// ── Card ──────────────────────────────────────────────────────────────────────

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-xl border border-border bg-card shadow-card min-w-0', className)} {...props} />;
}

export function CardHeader({ title, description, actions, className }: {
  title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3 px-5 pt-4', className)}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

// ── Segmented control (toggle group) ──────────────────────────────────────────

export function Segmented<T extends string>({ value, onChange, options, label, className, size = 'md' }: {
  value: T; onChange: (v: T) => void; options: readonly (T | { value: T; label: React.ReactNode })[];
  label: string; className?: string; size?: 'sm' | 'md';
}) {
  return (
    <ToggleGroupPrimitive.Root
      type="single"
      value={value}
      onValueChange={(v) => v && onChange(v as T)}
      aria-label={label}
      className={cn('inline-flex rounded-lg border border-border bg-muted p-0.5', className)}
    >
      {options.map((o) => {
        const v = typeof o === 'string' ? o : o.value;
        const text = typeof o === 'string' ? o : o.label;
        return (
          <ToggleGroupPrimitive.Item
            key={v}
            value={v}
            className={cn(
              'flex-1 rounded-md font-medium text-muted-foreground transition-colors hover:text-foreground cursor-pointer',
              'data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-[0_1px_2px_rgba(0,0,0,0.06),0_0_0_1px_var(--border-strong)]',
              size === 'sm' ? 'h-7 px-2.5 text-[13px]' : 'h-8 px-3.5 text-sm',
            )}
          >
            {text}
          </ToggleGroupPrimitive.Item>
        );
      })}
    </ToggleGroupPrimitive.Root>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

export const Tabs = TabsPrimitive.Root;
export const TabsContent = TabsPrimitive.Content;

export function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn('flex gap-1 overflow-x-auto border-b border-border px-3 [scrollbar-width:none]', className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        '-mb-px inline-flex h-10 items-center gap-1.5 whitespace-nowrap border-b-2 border-transparent px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground cursor-pointer',
        'data-[state=active]:border-accent data-[state=active]:text-foreground [&_svg]:size-4',
        className,
      )}
      {...props}
    />
  );
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

export function Tip({ content, children, side = 'top' }: { content: React.ReactNode; children: React.ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <TooltipPrimitive.Root delayDuration={250}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="z-50 max-w-64 rounded-md bg-primary px-2.5 py-1.5 text-xs text-primary-foreground shadow-pop"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export const TooltipProvider = TooltipPrimitive.Provider;

// ── Dropdown menu ─────────────────────────────────────────────────────────────

export const Menu = DropdownPrimitive.Root;
export const MenuTrigger = DropdownPrimitive.Trigger;

export function MenuContent({ className, ...props }: React.ComponentProps<typeof DropdownPrimitive.Content>) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        sideOffset={6}
        align="end"
        className={cn('z-50 min-w-52 rounded-lg border border-border bg-card p-1 shadow-pop', className)}
        {...props}
      />
    </DropdownPrimitive.Portal>
  );
}

export function MenuItem({ className, ...props }: React.ComponentProps<typeof DropdownPrimitive.Item>) {
  return (
    <DropdownPrimitive.Item
      className={cn(
        'flex cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-muted [&_svg]:size-4 [&_svg]:text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

export const MenuSeparator = () => <DropdownPrimitive.Separator className="my-1 h-px bg-border" />;

// ── Dialog ────────────────────────────────────────────────────────────────────

export function Dialog({ open, onOpenChange, title, description, children }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; children: React.ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-32px)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-5 shadow-pop">
          <div className="flex items-start justify-between gap-4">
            <div>
              <DialogPrimitive.Title className="text-base font-semibold">{title}</DialogPrimitive.Title>
              {description && <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">{description}</DialogPrimitive.Description>}
            </div>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Close"><X /></Button>
            </DialogPrimitive.Close>
          </div>
          <div className="mt-4">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// ── Inputs ────────────────────────────────────────────────────────────────────

export const TextInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn('h-9 w-full rounded-lg border border-border-strong bg-card px-3 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-accent-soft', className)}
    {...props}
  />
));
TextInput.displayName = 'TextInput';

// Number field that shows the full stored value (e.g. 0.0991) and only replaces it on edit.
export function NumberField({ id, label, value, onChange, unit, step = 0.01, min, max, decimals = 4, invalid, hint }: {
  id: string; label: string; value: number; onChange: (v: number) => void; unit?: string; step?: number;
  min?: number; max?: number; decimals?: number; invalid?: boolean; hint?: string;
}) {
  const format = React.useCallback((v: number) => v.toLocaleString('en-AU', { maximumFractionDigits: decimals }), [decimals]);
  const [text, setText] = React.useState(format(value));
  const [focused, setFocused] = React.useState(false);
  React.useEffect(() => { if (!focused) setText(format(value)); }, [value, focused, format]);

  const commit = (v: number) => {
    if (!Number.isFinite(v)) { setText(format(value)); return; }
    let next = v;
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    next = Number(next.toFixed(10));
    onChange(next);
    setText(format(next));
  };

  return (
    <div>
      <label htmlFor={id} className="mb-1 flex items-baseline justify-between gap-2 text-[13px] text-muted-foreground">
        <span>{label}</span>
        {hint && <span className="text-xs text-subtle">{hint}</span>}
      </label>
      <div className={cn(
        'flex h-9 overflow-hidden rounded-lg border bg-card transition-shadow focus-within:border-ring focus-within:ring-3 focus-within:ring-accent-soft',
        invalid ? 'border-danger' : 'border-border-strong',
      )}>
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          aria-invalid={invalid || undefined}
          className="tabular w-0 min-w-0 flex-1 bg-transparent px-3 text-right text-sm outline-none"
          value={text}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); commit(parseFloat(text.replace(/[,\s]/g, ''))); }}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              commit(value + (e.key === 'ArrowUp' ? step : -step));
            }
          }}
        />
        {unit && <span className="flex items-center pr-2.5 text-xs text-subtle">{unit}</span>}
      </div>
    </div>
  );
}

// ── Stat ──────────────────────────────────────────────────────────────────────

export function Stat({ label, value, unit, sub, keyColor, className }: {
  label: React.ReactNode; value: React.ReactNode; unit?: string; sub?: React.ReactNode; keyColor?: string; className?: string;
}) {
  return (
    <Card className={cn('px-4 py-3.5', className)}>
      <div className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
        {keyColor && <span className="h-[3px] w-3 rounded-full" style={{ background: keyColor }} />}
        {label}
      </div>
      <div className="mt-1.5 text-2xl font-semibold tracking-tight">
        {value}
        {unit && <span className="ml-1 text-[13px] font-medium text-muted-foreground">{unit}</span>}
      </div>
      {sub && <div className="mt-0.5 text-[13px] text-muted-foreground">{sub}</div>}
    </Card>
  );
}
