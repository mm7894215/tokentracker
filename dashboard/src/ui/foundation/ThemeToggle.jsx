import React from "react";
import { motion, useReducedMotion } from "motion/react";

/**
 * 主题切换按钮组件
 * 使用 useTheme hook 获取当前主题并切换 light/dark 模式
 */
export function ThemeToggle({
  theme,
  onToggle,
  className = "",
  size = 36,
  iconSize = 20,
}) {
  const shouldReduceMotion = useReducedMotion();
  const isDark = theme === "dark";

  const handleClick = () => {
    onToggle?.(isDark ? "light" : "dark");
  };

  const buttonStyles = {
    width: size,
    height: size,
    borderRadius: 8,
    background: "transparent",
    border: "none",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--oai-gray-600)",
    transition: "background-color 150ms ease, color 150ms ease",
  };

  const hoverStyles = {
    backgroundColor: "var(--oai-gray-100)",
    color: "var(--oai-black)",
  };

  // 太阳图标（亮色模式时显示）
  const SunIcon = () => (
    <svg
      aria-hidden="true"
      width={iconSize}
      height={iconSize}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  );

  // 月亮图标（暗色模式时显示）
  const MoonIcon = () => (
    <svg
      aria-hidden="true"
      width={iconSize}
      height={iconSize}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  );

  if (shouldReduceMotion) {
    return (
      <button
        type="button"
        aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
        onClick={handleClick}
        className={`oai-button-ghost oai-button-sm ${className}`}
        style={{
          ...buttonStyles,
          width: size,
          height: size,
          padding: 0,
        }}
        title={isDark ? "切换到亮色模式" : "切换到暗色模式"}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = hoverStyles.backgroundColor;
          e.currentTarget.style.color = hoverStyles.color;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = "transparent";
          e.currentTarget.style.color = "var(--oai-gray-600)";
        }}
      >
        {isDark ? <MoonIcon /> : <SunIcon />}
      </button>
    );
  }

  return (
    <motion.button
      type="button"
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={handleClick}
      className={`oai-button-ghost oai-button-sm ${className}`}
      style={{
        ...buttonStyles,
        width: size,
        height: size,
        padding: 0,
      }}
      title={isDark ? "切换到亮色模式" : "切换到暗色模式"}
      whileHover={{
        backgroundColor: "var(--oai-gray-100)",
        color: "var(--oai-black)",
      }}
      whileTap={{ scale: 0.95 }}
      transition={{
        type: "spring",
        stiffness: 400,
        damping: 25,
      }}
    >
      <motion.div
        key={isDark ? "moon" : "sun"}
        initial={{ scale: 0.8, opacity: 0, rotate: -20 }}
        animate={{ scale: 1, opacity: 1, rotate: 0 }}
        exit={{ scale: 0.8, opacity: 0, rotate: 20 }}
        transition={{
          type: "spring",
          stiffness: 400,
          damping: 25,
        }}
      >
        {isDark ? <MoonIcon /> : <SunIcon />}
      </motion.div>
    </motion.button>
  );
}

export default ThemeToggle;
