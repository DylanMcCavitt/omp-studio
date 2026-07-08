// The thin fixed icon rail pinned to the far right of the shell (AGE-630). Lists
// every railable destination (NAV_ENTRIES minus the primary `chat` surface),
// plus the Settings icon pinned at the bottom. Most icons toggle an overlay
// sheet; Settings opens a floating modal so the current center stays mounted.

import { IconButton } from "@/components/ui";
import { RAIL_ENTRIES, SETTINGS_ENTRY } from "@/lib/nav-registry";
import { useShellStore } from "@/store/shell";

export function RightRail() {
  const openPanelId = useShellStore((s) => s.openPanelId);
  const settingsModalOpen = useShellStore((s) => s.settingsModalOpen);
  const togglePanel = useShellStore((s) => s.togglePanel);
  const toggleSettingsModal = useShellStore((s) => s.toggleSettingsModal);

  const renderItem = (
    entry: (typeof RAIL_ENTRIES)[number],
    options?: { active?: boolean; onClick?: () => void },
  ) => {
    const { icon: Icon, label, route } = entry;
    const active = options?.active ?? openPanelId === route;
    return (
      <IconButton
        key={route}
        label={label}
        size="lg"
        variant={active ? "active" : "ghost"}
        onClick={options?.onClick ?? (() => togglePanel(route))}
        aria-pressed={active}
        className="relative"
      >
        {active && (
          <span
            aria-hidden
            className="absolute left-[-6px] h-5 w-0.5 rounded-r-full bg-accent"
          />
        )}
        <Icon size={16} className="shrink-0" />
      </IconButton>
    );
  };

  return (
    <nav
      aria-label="Tools"
      className="no-drag flex h-full w-12 shrink-0 flex-col items-center gap-1 border-l border-border bg-bg-raised py-2"
    >
      {RAIL_ENTRIES.map((entry) => renderItem(entry))}
      <div className="flex-1" />
      {renderItem(SETTINGS_ENTRY, {
        active: settingsModalOpen,
        onClick: toggleSettingsModal,
      })}
    </nav>
  );
}
