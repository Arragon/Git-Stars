// src/pages/NotFound.tsx
// Friendly 404 for unknown routes.

import React from "react";
import { Link } from "react-router-dom";
import { Compass } from "lucide-react";

export const NotFound: React.FC = () => (
  <div className="max-w-lg mx-auto p-8 text-center">
    <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-10 space-y-4">
      <Compass className="h-12 w-12 text-gray-300 dark:text-gray-600 mx-auto" />
      <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
        页面不存在
      </h1>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        你访问的地址不存在或已被移动。
      </p>
      <Link
        to="/library"
        className="inline-block bg-gray-900 dark:bg-gray-100 dark:text-gray-900 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-gray-700 dark:hover:bg-gray-300"
      >
        返回 Library
      </Link>
    </div>
  </div>
);
