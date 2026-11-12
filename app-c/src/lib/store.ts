// App state: current quote, saved quotes and theme. Persisted per browser
// (localStorage); everything still works if storage is unavailable.

import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { DEFAULT_INPUTS, applyNetworkPreset, type QuoteInputs, type State } from './calc';

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
  setNetwork: (network: string) => void;
  setInputs: (inputs: QuoteInputs) => void;
  resetInputs: () => void;
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
  setNetwork: (network) => set((s) => ({ inputs: applyNetworkPreset(s.inputs, network) })),
  setInputs: (inputs) => set({ inputs }),
  resetInputs: () => set({ inputs: { ...DEFAULT_INPUTS } }),
  setState: (state) => set({ state }),
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
  version: 1,
  storage: createJSONStorage(() => safeStorage),
  partialize: (s) => ({ inputs: s.inputs, state: s.state, saved: s.saved, compareIds: s.compareIds, theme: s.theme }),
}));
