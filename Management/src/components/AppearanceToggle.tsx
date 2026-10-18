import { Monitor, Sun, Moon } from "lucide-react";
import { useTheme, type ThemePreference } from "../contexts/ThemeContext";

interface AppearanceToggleProps {
  collapsed?: boolean;
}

const OPTIONS: { value: ThemePreference; icon: typeof Monitor; label: string }[] = [
  { value: "system", icon: Monitor, label: "System" },
  { value: "light", icon: Sun, label: "Light" },
  { value: "dark", icon: Moon, label: "Dark" },
];

const AppearanceToggle = ({ collapsed = false }: AppearanceToggleProps) => {
  const { theme, setTheme } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Appearance"
      className={`flex ${collapsed ? "flex-col items-center gap-1 p-0" : "flex-row gap-1 p-1 bg-sidebar-accent"} rounded-lg`}
    >
      {OPTIONS.map(({ value, icon: Icon, label }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => setTheme(value)}
            className={`${collapsed ? "h-9 w-9" : "flex-1 h-8"} flex items-center justify-center rounded-lg transition-colors duration-150 ${
              active
                ? "bg-sidebar-primary text-sidebar-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className={collapsed ? "h-[18px] w-[18px]" : "w-4 h-4"} />
          </button>
        );
      })}
    </div>
  );
};

export default AppearanceToggle;
