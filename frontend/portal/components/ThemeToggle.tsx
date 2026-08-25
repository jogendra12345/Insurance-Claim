"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

const STORAGE_KEY = "claimflow-theme";

function applyTheme(theme: Theme) {
  if (theme === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");
  const [flicker, setFlicker] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const initial = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    setTheme(initial);
    setMounted(true);
  }, []);

  function toggle() {
    const next: Theme = theme === "light" ? "dark" : "light";
    setTheme(next);
    applyTheme(next);
    localStorage.setItem(STORAGE_KEY, next);
    setFlicker(true);
    window.setTimeout(() => setFlicker(false), 600);
  }

  // Reserve layout space pre-mount so the toggle doesn't cause a page jump.
  if (!mounted) {
    return <span style={{ display: "inline-block", width: "34px", height: "34px" }} aria-hidden="true" />;
  }

  const isLit = theme === "light";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isLit ? "Switch to dark theme" : "Switch to light theme"}
      aria-pressed={!isLit}
      title={isLit ? "Bulb: on (light theme)" : "Bulb: off (dark theme)"}
      className={`bulb-toggle btn-press${isLit ? " is-lit" : ""}${flicker ? " bulb-flicker" : ""}`}
    >
      <svg
        className="bulb-icon"
        viewBox="0 0 24 24"
        width="22"
        height="22"
        aria-hidden="true"
      >
        <path
          className="bulb-glass"
          d="M12 2.5c-3.7 0-6.7 3-6.7 6.7 0 2.4 1.25 4.15 2.3 5.4.65.75 1.1 1.3 1.1 1.9v.5a1 1 0 0 0 1 1h4.6a1 1 0 0 0 1-1v-.5c0-.6.45-1.15 1.1-1.9 1.05-1.25 2.3-3 2.3-5.4 0-3.7-3-6.7-6.7-6.7Z"
          fill="none"
          strokeWidth="1.5"
        />
        <path className="bulb-filament" d="M10 9.7 12 12l2-2.3M12 12v3.2" fill="none" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        <rect className="bulb-base" x="9.3" y="18.6" width="5.4" height="1.5" rx="0.5" />
        <rect className="bulb-base" x="9.7" y="20.4" width="4.6" height="1.3" rx="0.5" />
      </svg>
    </button>
  );
}
