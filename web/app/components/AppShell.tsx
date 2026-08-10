import type { ReactNode } from "react";

// Two-column split on desktop; on mobile (<768px, see globals.css) CSS
// toggles which panel is visible based on data-has-selection — both panels
// stay in the DOM either way, no separate mobile route needed.
export default function AppShell({
  masterPanel,
  detailPanel,
  hasSelection,
}: {
  masterPanel: ReactNode;
  detailPanel: ReactNode;
  hasSelection: boolean;
}) {
  return (
    <div className="app-shell" data-has-selection={hasSelection}>
      <div className="master-panel">{masterPanel}</div>
      <div className="detail-panel-wrap">{detailPanel}</div>
    </div>
  );
}
