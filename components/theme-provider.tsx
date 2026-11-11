"use client";
import { createContext, useContext, useState, type ReactNode } from "react";
import { Sun, Moon, Monitor } from "lucide-react";
export type Theme = "light" | "dark" | "system";
const ThemeContext = createContext<{
  theme: Theme;
  change: (theme: Theme) => void;
}>({ theme: "system", change: () => {} });
export function ThemeProvider({
  initialTheme,
  children,
}: {
  initialTheme: Theme;
  children: ReactNode;
}) {
  const [theme, setTheme] = useState(initialTheme);
  function change(next: Theme) {
    document.documentElement.dataset.theme = next;
    document.cookie = `recall-theme=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    setTheme(next);
  }
  return (
    <ThemeContext.Provider value={{ theme, change }}>
      {children}
    </ThemeContext.Provider>
  );
}
export function ThemeControl() {
  const { theme, change } = useContext(ThemeContext);
  const Icon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;
  return (
    <label className="theme-control">
      <Icon size={15} />
      <span className="sr-only">Appearance</span>
      <select
        aria-label="Appearance"
        value={theme}
        onChange={(event) => change(event.target.value as Theme)}
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}
