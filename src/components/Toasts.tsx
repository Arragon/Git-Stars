// src/components/Toasts.tsx
// Global toast container (prototype `.toast-container` / `.toast`).

import React from "react";
import { Check } from "lucide-react";
import { useToastStore } from "../store/useToastStore";

export const Toasts: React.FC = () => {
  const toast = useToastStore((s) => s.toast);
  const clearToast = useToastStore((s) => s.clearToast);
  if (!toast) return null;
  return (
    <div
      className="toast-container"
      role="status"
      aria-live="polite"
      style={{ left: "50%" }}
    >
      <div className="toast">
        <Check className="ico" />
        <span>{toast.message}</span>
        {toast.undo && (
          <button
            type="button"
            onClick={() => {
              toast.undo?.();
              clearToast();
            }}
          >
            撤销
          </button>
        )}
      </div>
    </div>
  );
};
