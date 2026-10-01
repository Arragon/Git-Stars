// src/components/ui.tsx
// Minimal shared UI primitives (design-system seeds). Every primitive ships
// complete dark-mode variants, focus-visible rings and disabled states so page
// code stops hand-rolling one-off class strings. Visual language: GitHub-style
// mature tool UI — light canvas, white bordered cards, dark primary buttons.

import React from "react";

// --- class building blocks (exported for rare one-off composition) ---

export const focusRing =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-gray-900";

export const inputBase =
  "block w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 " +
  "text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 " +
  "text-sm shadow-sm transition-colors " +
  "focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 " +
  "disabled:opacity-50 disabled:cursor-not-allowed";

// --- Button ---

export type ButtonVariant =
  "primary" | "secondary" | "ghost" | "danger" | "brand";

export type ButtonSize = "sm" | "md" | "icon";

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    "bg-gray-900 dark:bg-gray-100 dark:text-gray-900 text-white hover:bg-gray-700 dark:hover:bg-gray-300 border border-transparent",
  secondary:
    "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700",
  ghost:
    "bg-transparent text-gray-600 dark:text-gray-300 border border-transparent hover:bg-gray-100 dark:hover:bg-gray-800",
  danger: "bg-red-600 text-white border border-transparent hover:bg-red-700",
  brand:
    "bg-purple-600 text-white border border-transparent hover:bg-purple-700",
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: "text-xs px-2.5 py-1.5 gap-1",
  md: "text-sm px-4 py-2 gap-1.5",
  icon: "p-2",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button: React.FC<ButtonProps> = ({
  variant = "primary",
  size = "md",
  className = "",
  type = "button",
  ...rest
}) => (
  <button
    type={type}
    className={`inline-flex items-center justify-center rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${buttonVariants[variant]} ${buttonSizes[size]} ${focusRing} ${className}`}
    {...rest}
  />
);

// --- Card ---

export const Card: React.FC<{
  className?: string;
  children: React.ReactNode;
  hover?: boolean;
}> = ({ className = "", children, hover = false }) => (
  <div
    className={`bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 shadow-card ${
      hover
        ? "transition-[border-color,box-shadow] hover:border-gray-300 dark:hover:border-gray-700 hover:shadow-card-hover"
        : ""
    } ${className}`}
  >
    {children}
  </div>
);

// --- Page header (title + description + actions row) ---

export const PageHeader: React.FC<{
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}> = ({ title, description, actions, children }) => (
  <div className="flex flex-wrap items-center justify-between gap-3">
    <div className="min-w-0">
      <h1 className="text-xl font-semibold tracking-tight truncate">{title}</h1>
      {description && (
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          {description}
        </p>
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

export type BadgeTone = "neutral" | "brand" | "success" | "warning" | "info";

const badgeTones: Record<BadgeTone, string> = {
  neutral:
    "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-700",
  brand:
    "bg-brand-50 dark:bg-brand-500/10 text-brand-700 dark:text-brand-300 border-brand-200 dark:border-brand-500/30",
  success:
    "bg-green-50 dark:bg-green-950/50 text-green-700 dark:text-green-300 border-green-200 dark:border-green-900",
  warning:
    "bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900",
  info: "bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-900",
};

export const Badge: React.FC<{
  tone?: BadgeTone;
  className?: string;
  children: React.ReactNode;
}> = ({ tone = "neutral", className = "", children }) => (
  <span
    className={`inline-flex items-center gap-1 text-xs rounded px-1.5 py-0.5 border ${badgeTones[tone]} ${className}`}
  >
    {children}
  </span>
);

// --- Form controls ---

export const Input: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = ({
  className = "",
  ...rest
}) => <input className={`${inputBase} ${className}`} {...rest} />;

export const Select: React.FC<
  React.SelectHTMLAttributes<HTMLSelectElement>
> = ({ className = "", ...rest }) => (
  <select
    className={`${inputBase} pl-3 pr-8 cursor-pointer ${className}`}
    {...rest}
  />
);

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

// --- Notice (error / info banner) ---

export const Notice: React.FC<{
  tone: "error" | "info" | "success";
  children: React.ReactNode;
}> = ({ tone, children }) => {
  const tones = {
    error:
      "text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/50 border-red-200 dark:border-red-900",
    info: "text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-900",
    success:
      "text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-950/50 border-green-200 dark:border-green-900",
  };
  return (
    <div
      className={`text-sm rounded-md border px-3 py-2 ${tones[tone]}`}
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
  className?: string;
}> = ({ icon, title, description, action, className = "" }) => (
  <div
    className={`text-center py-12 bg-white dark:bg-gray-900 rounded-lg border border-dashed border-gray-300 dark:border-gray-700 ${className}`}
  >
    <div className="text-gray-300 dark:text-gray-600 flex justify-center mb-3 [&>svg]:h-10 [&>svg]:w-10">
      {icon}
    </div>
    <p className="text-gray-600 dark:text-gray-300 text-sm mb-1">{title}</p>
    {description && (
      <p className="text-gray-400 dark:text-gray-500 text-xs mb-4">
        {description}
      </p>
    )}
    {action}
  </div>
);
