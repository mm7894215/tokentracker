import React from "react";
import { useTheme } from "../../../hooks/useTheme.js";
import { ThemeToggle } from "../../foundation/ThemeToggle.jsx";

/**
 * Brand Logo component
 */
function BrandLogo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="w-8 h-8 rounded-lg bg-oai-black dark:bg-oai-white flex items-center justify-center">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-oai-white dark:text-oai-black">
          <path d="M12 2L2 7l10 5 10-5-10-5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
      <span className="text-base font-semibold text-oai-black dark:text-oai-white leading-tight">
        Token Tracker
      </span>
    </div>
  );
}

/**
 * Shell - OpenAI 风格的外壳布局组件
 *
 * @param {Object} props
 * @param {React.ReactNode} props.children - 内容区域
 * @param {React.ReactNode} [props.header] - 自定义头部内容
 * @param {React.ReactNode} [props.footer] - 自定义底部内容
 * @param {string} [props.className] - 额外的 CSS 类名
 * @param {boolean} [props.hideHeader=false] - 是否隐藏头部
 * @param {boolean} [props.hideFooter=false] - 是否隐藏底部
 */
export function Shell({
  children,
  header,
  footer,
  className = "",
  hideHeader = false,
  hideFooter = false,
}) {
  const { resolvedTheme, toggleTheme } = useTheme();

  return (
    <div
      className={`min-h-screen bg-oai-white dark:bg-oai-gray-950 text-oai-black dark:text-oai-white font-sans flex flex-col transition-colors duration-200 ${className}`}
    >
      {!hideHeader && (
        <header className="border-b border-oai-gray-200 dark:border-oai-gray-800 px-6 py-4 flex items-center justify-between transition-colors duration-200">
          <BrandLogo />
          <div className="flex-1 flex justify-center">{header}</div>
          <ThemeToggle theme={resolvedTheme} onToggle={toggleTheme} />
        </header>
      )}

      <main className="flex-1 px-6 py-6">{children}</main>

      {!hideFooter && footer && (
        <footer className="border-t border-oai-gray-200 dark:border-oai-gray-800 px-6 py-4 mt-auto transition-colors duration-200">
          {footer}
        </footer>
      )}
    </div>
  );
}
