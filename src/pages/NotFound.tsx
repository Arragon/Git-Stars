// src/pages/NotFound.tsx
// Pixel-faithful port of the prototype `notFound()` (GitStars-Redesign.html).

import React from "react";
import { Link } from "react-router-dom";

function LibraryGlyph({ className = "ico" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path d="M4 4h4v16H4zM11 4h4v16h-4zM18 4l4 15-3.5 1-4-15z" />
    </svg>
  );
}

function CompassGlyph({ className = "ico" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" />
      <path d="m16 8-2.5 5.5L8 16l2.5-5.5Z" />
    </svg>
  );
}

export const NotFound: React.FC = () => (
  <section className="notfound">
    <div className="error-code">404</div>
    <h1>这个页面暂时找不到</h1>
    <p>
      链接可能已经变更，或地址输入有误。
      <br />
      从收藏库或 Hub 继续浏览。
    </p>
    <div className="row wrap" style={{ justifyContent: "center" }}>
      <Link to="/library" className="btn primary">
        <LibraryGlyph /> 返回收藏库
      </Link>
      <Link to="/hub" className="btn">
        <CompassGlyph /> 浏览 Hub
      </Link>
    </div>
  </section>
);
