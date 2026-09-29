import { create } from "zustand";

export type TabName = "Scan" | "Data" | "Settings";

export interface Toast {
  id: number;
  msg: string;
  tone: "good" | "warn" | "bad";
  action?: { label: string; run: () => void };
  ms?: number;
}

export interface SaveStatus {
  state: "idle" | "saving" | "saved" | "error";
  at?: number;
  path?: string;
  error?: string;
}

interface UiState {
  tab: TabName;
  toasts: Toast[];
  save: SaveStatus;
  shortcutsOpen: boolean;
  setTab: (t: TabName) => void;
  toast: (msg: string, tone?: Toast["tone"], action?: Toast["action"], ms?: number) => void;
  dismiss: (id: number) => void;
  setSave: (s: SaveStatus) => void;
  setShortcutsOpen: (v: boolean) => void;
}

let nextId = 1;

export const useUi = create<UiState>((set, get) => ({
  tab: "Scan",
  toasts: [],
  save: { state: "idle" },
  shortcutsOpen: false,
  setTab: (t) => set({ tab: t }),
  toast: (msg, tone = "good", action, ms) => {
    const id = nextId++;
    set({ toasts: [...get().toasts.slice(-2), { id, msg, tone, action, ms }] });
    setTimeout(() => get().dismiss(id), ms ?? (action ? 7000 : tone === "bad" ? 8000 : 3200));
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  setSave: (s) => set({ save: s }),
  setShortcutsOpen: (v) => set({ shortcutsOpen: v }),
}));
