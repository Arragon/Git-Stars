// src/store/useToastStore.ts
// Lightweight toast notifications (prototype `.toast` styles).

import { create } from "zustand";

export interface ToastState {
  message: string;
  undo?: () => void;
  id: number;
}

interface ToastStore {
  toast: ToastState | null;
  showToast: (message: string, undo?: () => void) => void;
  clearToast: () => void;
}

let timer: ReturnType<typeof setTimeout> | null = null;

export const useToastStore = create<ToastStore>((set) => ({
  toast: null,
  showToast: (message, undo) => {
    if (timer) clearTimeout(timer);
    set({ toast: { message, undo, id: Date.now() } });
    timer = setTimeout(
      () => {
        set({ toast: null });
      },
      undo ? 8500 : 4500,
    );
  },
  clearToast: () => {
    if (timer) clearTimeout(timer);
    set({ toast: null });
  },
}));
