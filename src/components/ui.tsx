// src/components/ui.tsx
// Shared UI primitives (GitStars redesign baseline). Every primitive is
// theme-aware through the semantic color tokens defined in src/index.css
// (bg-surface, text-ink, border-line, bg-brand …), ships focus-visible rings
// and disabled states, and keeps the pre-redesign export signatures.

import React, { useEffect, useRef } from "react";

// --- class building blocks (exported for rare one-off composition) ---

export const focusRing =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--c-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--c-canvas)]";

export const inputBase =
  "block w-full min-h-[36px] rounded-[7px] border border-line-strong bg-surface " +
  "text-ink placeholder-muted text-[13px] transition-colors " +
  "focus:outline-none focus:border-[var(--c-focus)] disabled:opacity-50 disabled:cursor-not-allowed";

// --- Button ---

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "danger-solid"
  | "ai"
  | "brand";

export type ButtonSize = "xs" | "sm" | "md" | "icon";

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    "bg-brand text-[color:var(--c-brand-contrast)] border border-brand hover:bg-[var(--c-brand-hover)] hover:border-[var(--c-brand-hover)]",
  secondary:
    "bg-surface text-ink border border-line hover:bg-subtle hover:border-line-strong",
  ghost:
    "bg-transparent text-muted border border-transparent hover:bg-subtle hover:text-ink",
  danger:
    "bg-transparent text-[color:var(--c-danger)] border border-[color:var(--c-danger)] hover:bg-[color:var(--c-danger-soft)]",
  "danger-solid":
    "bg-[color:var(--c-danger)] text-surface border border-[color:var(--c-danger)] hover:opacity-90",
  ai: "bg-transparent text-ai border border-transparent hover:bg-ai-soft",
  brand: "bg-gold-soft text-gold border border-gold/30 hover:border-gold/60",
};

const buttonSizes: Record<ButtonSize, string> = {
  xs: "text-[11px] min-h-[29px] px-1.5 gap-1",
  sm: "text-xs min-h-[30px] px-2.5 gap-1.5",
  md: "text-[13px] min-h-[36px] px-3 gap-[7px]",
  icon: "w-[34px] h-[34px] p-[7px] justify-center",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button: React.FC<ButtonProps> = ({
  variant = "secondary",
  size = "md",
  className = "",
  type = "button",
  ...rest
}) => (
  <button
    type={type}
    className={`inline-flex items-center justify-center font-medium border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${buttonVariants[variant]} ${buttonSizes[size]} ${focusRing} ${className}`}
    {...rest}
  />
);

export interface IconButtonProps extends Omit<ButtonProps, "aria-label"> {
  "aria-label": string;
}

export const IconButton: React.FC<IconButtonProps> = ({
  className = "",
  ...rest
}) => <Button size="icon" className={className} {...rest} />;

// --- Card ---

export const Card: React.FC<{
  className?: string;
  children: React.ReactNode;
  hover?: boolean;
}> = ({ className = "", children, hover = false }) => (
  <div
    className={`bg-surface border border-line rounded-xl ${
      hover ? "transition-colors hover:border-line-strong" : ""
    } ${className}`}
  >
    {children}
  </div>
);

// --- Page header ---

export const PageHeader: React.FC<{
  title: string;
  description?: string;
  badge?: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}> = ({ title, description, badge, actions, children }) => (
  <div className="flex items-center justify-between gap-4 mb-[22px] flex-wrap">
    <div className="min-w-0">
      <div className="flex items-center gap-3">
        <h1 className="text-[26px] leading-[1.35] font-[650] tracking-[-0.025em] truncate">
          {title}
        </h1>
        {badge && <span className="text-xs">{badge}</span>}
      </div>
      {description && (
        <p className="text-xs text-muted mt-1.5">{description}</p>
      )}
    </div>
    {(actions || children) && (
      <div className="flex items-center gap-2 shrink-0">
        {children}
        {actions}
      </div>
    )}
  </div>
);

// --- Badge ---

export type BadgeTone =
  "neutral" | "brand" | "gold" | "ai" | "info" | "success" | "danger";

const badgeTones: Record<BadgeTone, string> = {
  neutral: "bg-subtle text-muted border-transparent",
  brand: "bg-brand-soft text-brand-text border-transparent",
  gold: "bg-gold-soft text-gold border-transparent",
  ai: "bg-ai-soft text-ai border-transparent",
  info: "bg-info-soft text-info border-transparent",
  success: "bg-brand-soft text-brand-text border-transparent",
  danger: "bg-danger-soft text-danger border-transparent",
};

export const Badge: React.FC<{
  tone?: BadgeTone;
  className?: string;
  children: React.ReactNode;
}> = ({ tone = "neutral", className = "", children }) => (
  <span
    className={`inline-flex items-center gap-[5px] whitespace-nowrap text-[11px] font-medium rounded-[5px] px-[7px] py-[3px] border ${badgeTones[tone]} ${className}`}
  >
    {children}
  </span>
);

// --- Form controls ---

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className = "", ...rest }, ref) => (
  <input ref={ref} className={`${inputBase} ${className}`} {...rest} />
));
Input.displayName = "Input";

export const Select: React.FC<
  React.SelectHTMLAttributes<HTMLSelectElement>
> = ({ className = "", ...rest }) => (
  <select
    className={`${inputBase} w-auto min-w-[130px] cursor-pointer py-[6px] pl-2.5 pr-[29px] text-xs ${className}`}
    {...rest}
  />
);

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className = "", ...rest }, ref) => (
  <textarea
    ref={ref}
    className={`${inputBase} min-h-[100px] resize-y leading-[1.7] py-2 ${className}`}
    {...rest}
  />
));
Textarea.displayName = "Textarea";

// --- Spinner ---

export const Spinner: React.FC<{ className?: string }> = ({
  className = "h-4 w-4",
}) => (
  <span
    className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
    role="status"
    aria-label="loading"
  />
);

// --- Notice ---

export const Notice: React.FC<{
  tone: "error" | "info" | "success" | "warning";
  children: React.ReactNode;
}> = ({ tone, children }) => {
  const tones = {
    error: "bg-danger-soft text-danger border-line",
    info: "bg-info-soft text-info border-line",
    success: "bg-brand-soft text-brand-text border-line",
    warning: "bg-gold-soft text-gold border-line",
  };
  return (
    <div
      className={`flex items-center gap-2.5 text-xs rounded-lg border px-3.5 py-2.5 mb-[18px] break-words ${tones[tone]}`}
      role={tone === "error" ? "alert" : undefined}
    >
      {children}
    </div>
  );
};

// --- Empty state ---

export const EmptyState: React.FC<{
  icon: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  secondary?: React.ReactNode;
  className?: string;
}> = ({ icon, title, description, action, secondary, className = "" }) => (
  <div
    className={`py-[72px] px-6 text-center bg-surface border border-line rounded-xl ${className}`}
  >
    <div className="w-[52px] h-[52px] rounded-2xl bg-subtle text-muted grid place-items-center mx-auto mb-[19px] [&>svg]:h-6 [&>svg]:w-6">
      {icon}
    </div>
    <h2 className="text-lg font-[650] mb-2">{title}</h2>
    {description && (
      <p className="text-[13px] text-muted max-w-[410px] mx-auto leading-[1.8]">
        {description}
      </p>
    )}
    {(action || secondary) && (
      <div className="flex flex-wrap gap-2 justify-center mt-[23px]">
        {action}
        {secondary}
      </div>
    )}
  </div>
);

// --- Skeletons ---

export const Skeleton: React.FC<{ className?: string }> = ({
  className = "",
}) => (
  <div className={`h-3 rounded-[5px] bg-subtle animate-pulse ${className}`} />
);

export const SkeletonCard: React.FC<{ className?: string }> = ({
  className = "",
}) => (
  <div
    className={`h-[216px] bg-surface border border-line rounded-xl p-5 flex flex-col gap-[18px] ${className}`}
    role="status"
    aria-label="正在加载"
  >
    <Skeleton className="w-[42%] h-5" />
    <Skeleton className="w-[85%]" />
    <Skeleton className="w-[64%]" />
    <Skeleton className="w-[72%] mt-auto" />
  </div>
);

// --- Dialog (native <dialog>; Esc handled by the platform) ---

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  variant?: "modal" | "drawer";
  width?: string;
}

export const Dialog: React.FC<DialogProps> = ({
  open,
  onClose,
  title,
  children,
  footer,
  variant = "modal",
  width = "520px",
}) => {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={`bg-surface text-ink rounded-[15px] w-full max-w-[calc(100vw-32px)] max-h-[calc(100dvh-48px)] overflow-auto p-0 backdrop:bg-black/40`}
      style={{ width: variant === "modal" ? width : undefined }}
    >
      <div className="flex justify-between items-center px-6 py-[21px] border-b border-line sticky top-0 bg-surface z-10">
        <h2 className="text-[17px] font-[650]">{title}</h2>
        <Button variant="ghost" size="icon" aria-label="关闭" onClick={onClose}>
          ✕
        </Button>
      </div>
      <div className="px-6 py-[23px] text-[13px]">{children}</div>
      {footer && (
        <div className="flex flex-wrap justify-end gap-2 px-6 py-[17px] border-t border-line bg-surface sticky bottom-0">
          {footer}
        </div>
      )}
    </dialog>
  );
};

// --- Confirm dialog (built on Dialog) ---

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  body,
  confirmLabel = "确认",
  cancelLabel = "取消",
  danger = false,
  onConfirm,
  onCancel,
}) => (
  <Dialog
    open={open}
    onClose={onCancel}
    title={title}
    footer={
      <>
        <Button variant="secondary" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button
          variant={danger ? "danger-solid" : "primary"}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </>
    }
  >
    {body}
  </Dialog>
);
