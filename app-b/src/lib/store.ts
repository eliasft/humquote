// App state: current quote, saved quotes and theme. Persisted per browser
// (localStorage); everything still works if storage is unavailable.

import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { DEFAULT_INPUTS, applyTariff, migrateInputs, type QuoteInputs, type State } from '@/core/calc';
import { inputsForState } from '@/core/analysis';
import { tariffById } from '@/core/tariffs';

export type Theme = 'system' | 'light' | 'dark';

export interface SavedQuote {
  id: string;
  name: string;
  createdAt: string;
  state: State;
  inputs: QuoteInputs;
  priceAtSave: number;
  dataDate: string;
}

interface Store {
  inputs: QuoteInputs;
  state: State;
  saved: SavedQuote[];
  compareIds: string[];
  theme: Theme;
  setInput: <K extends keyof QuoteInputs>(key: K, value: QuoteInputs[K]) => void;
  setTariff: (tariffId: string) => void;
  setInputs: (inputs: QuoteInputs) => void;
  resetInputs: () => void;
  // Switching state also switches to that state's default tariff for the same
  // segment (a tariff only applies in its own state).
  setState: (state: State) => void;
  saveQuote: (q: Omit<SavedQuote, 'id' | 'createdAt'>) => SavedQuote;
  renameQuote: (id: string, name: string) => void;
  deleteQuote: (id: string) => void;
  toggleCompare: (id: string) => void;
  setTheme: (theme: Theme) => void;
}

const safeStorage: StateStorage = {
  getItem: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  setItem: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
  removeItem: (k) => { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } },
};

const newId = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export const useStore = create<Store>()(persist((set) => ({
  inputs: { ...DEFAULT_INPUTS },
  state: 'NSW',
  saved: [],
  compareIds: [],
  theme: 'system',
  setInput: (key, value) => set((s) => ({ inputs: { ...s.inputs, [key]: value } })),
  setTariff: (tariffId) => set((s) => {
    const t = tariffById(tariffId);
    return t ? { inputs: applyTariff(s.inputs, t) } : {};
  }),
  setInputs: (inputs) => set({ inputs }),
  resetInputs: () => set((s) => ({ inputs: inputsForState({ ...DEFAULT_INPUTS }, s.state) })),
  setState: (state) => set((s) => ({ state, inputs: inputsForState(s.inputs, state) })),
  saveQuote: (q) => {
    const quote = { ...q, id: newId(), createdAt: new Date().toISOString() };
    set((s) => ({ saved: [quote, ...s.saved] }));
    return quote;
  },
  renameQuote: (id, name) => set((s) => ({ saved: s.saved.map((q) => (q.id === id ? { ...q, name } : q)) })),
  deleteQuote: (id) => set((s) => ({ saved: s.saved.filter((q) => q.id !== id), compareIds: s.compareIds.filter((c) => c !== id) })),
  toggleCompare: (id) => set((s) => {
    if (s.compareIds.includes(id)) return { compareIds: s.compareIds.filter((c) => c !== id) };
    return { compareIds: [...s.compareIds, id].slice(-3) };
  }),
  setTheme: (theme) => set({ theme }),
}), {
  name: 'bulk-quote',
  version: 2,
  // v1 stored a preset name in inputs.network and had no contract inputs.
  migrate: (persisted, version) => {
    const p = persisted as { inputs?: Record<string, unknown>; saved?: { inputs: Record<string, unknown> }[] };
    if (version < 2) {
      if (p.inputs) p.inputs = migrateInputs(p.inputs) as unknown as Record<string, unknown>;
      p.saved = (p.saved ?? []).map((q) => ({ ...q, inputs: migrateInputs(q.inputs) as unknown as Record<string, unknown> }));
    }
    return p as Partial<Store>;
  },
  storage: createJSONStorage(() => safeStorage),
  partialize: (s) => ({ inputs: s.inputs, state: s.state, saved: s.saved, compareIds: s.compareIds, theme: s.theme }),
}));
