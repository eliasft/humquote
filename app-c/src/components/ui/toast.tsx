// Minimal toast notifications ("Link copied", "Quote saved").

import { create } from 'zustand';
import { CheckCircle2 } from 'lucide-react';

interface ToastState {
  items: { id: number; text: string }[];
  push: (text: string) => void;
}

let next = 0;

export const useToasts = create<ToastState>((set) => ({
  items: [],
  push: (text) => {
    const id = ++next;
    set((s) => ({ items: [...s.items, { id, text }] }));
    setTimeout(() => set((s) => ({ items: s.items.filter((t) => t.id !== id) })), 2600);
  },
}));

export const toast = (text: string) => useToasts.getState().push(text);

export function Toaster() {
  const items = useToasts((s) => s.items);
  return (
    <div className="no-print pointer-events-none fixed bottom-20 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2 lg:bottom-6" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className="flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm text-primary-foreground shadow-pop">
          <CheckCircle2 className="size-4" />
          {t.text}
        </div>
      ))}
    </div>
  );
}
