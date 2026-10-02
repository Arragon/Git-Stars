// src/pages/NotFound.tsx
// Friendly 404 for unknown routes.

import React from "react";
import { Link } from "react-router-dom";
import { Compass } from "lucide-react";

export const NotFound: React.FC = () => (
  <div className="max-w-lg mx-auto p-8 text-center">
    <div className="bg-surface rounded-lg border border-line p-10 space-y-4">
      <Compass className="h-12 w-12 text-muted opacity-60 mx-auto" />
      <h1 className="text-xl font-bold text-ink">页面不存在</h1>
      <p className="text-sm text-muted">你访问的地址不存在或已被移动。</p>
      <Link
        to="/library"
        className="inline-block bg-brand text-[color:var(--c-brand-contrast)] px-4 py-2 rounded-md text-sm font-medium hover:bg-[var(--c-brand-hover)]"
      >
        返回 Library
      </Link>
    </div>
  </div>
);
