"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { SelectedDetail } from "@/lib/dashboardView";
import AppShell from "./AppShell";
import MasterList, { type MasterListSection } from "./MasterList";
import DetailPanel from "./DetailPanel";

interface DashboardContextValue {
  select: (id: string) => void;
  clearSelection: () => void;
  // Optimistic delete: hide rows immediately, before the DELETE request and
  // router.refresh() round-trip finish. unhide() rolls back on failure.
  hide: (ids: string[]) => void;
  unhide: (ids: string[]) => void;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

export function useDashboard(): DashboardContextValue | null {
  return useContext(DashboardContext);
}

// True once we've pushed a ?sel= entry ourselves this session, so the mobile
// "back" button can pop it (matching the swipe-back gesture) instead of
// growing history.
let pushedSelection = false;

export default function Dashboard({
  sections,
  details,
}: {
  sections: MasterListSection[];
  details: Record<string, SelectedDetail>;
}) {
  const searchParams = useSearchParams();
  const explicitSel = searchParams.get("sel");
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const masterScrollRef = useRef(0);

  const visibleSections = useMemo(
    () => sections.map((s) => ({ ...s, rows: s.rows.filter((r) => !hidden.has(r.id)) })),
    [sections, hidden]
  );
  const firstVisibleId = visibleSections.flatMap((s) => s.rows)[0]?.id ?? null;

  const validExplicit = explicitSel && details[explicitSel] && !hidden.has(explicitSel) ? explicitSel : null;
  // Desktop always shows something in the detail pane (first row by
  // default); mobile only switches to the detail view on an explicit tap.
  const selectedId = validExplicit ?? firstVisibleId;
  const detail = selectedId ? (details[selectedId] ?? null) : null;

  // Server data that's caught up with a delete no longer has the row — drop
  // it from the hidden set so the set doesn't grow forever.
  useEffect(() => {
    setHidden((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set([...prev].filter((id) => id in details));
      return next.size === prev.size ? prev : next;
    });
  }, [details]);

  const select = useCallback(
    (id: string) => {
      if (id === explicitSel) return;
      const master = document.querySelector(".master-panel");
      if (master) masterScrollRef.current = master.scrollTop;
      const url = `?sel=${encodeURIComponent(id)}`;
      // Push only when leaving the list, replace when switching between
      // rows — so one "back" (button or swipe) always returns to the list.
      if (explicitSel) {
        window.history.replaceState(null, "", url);
      } else {
        window.history.pushState(null, "", url);
        pushedSelection = true;
      }
    },
    [explicitSel]
  );

  const clearSelection = useCallback(() => {
    if (pushedSelection) {
      pushedSelection = false;
      window.history.back();
    } else {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  const hide = useCallback(
    (ids: string[]) => {
      setHidden((prev) => new Set([...prev, ...ids]));
      if (explicitSel && ids.includes(explicitSel)) {
        window.history.replaceState(null, "", window.location.pathname);
      }
    },
    [explicitSel]
  );

  const unhide = useCallback((ids: string[]) => {
    setHidden((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
  }, []);

  // Reset detail scroll on selection change; restore list scroll when going
  // back to the list on mobile (display:none drops scrollTop).
  useLayoutEffect(() => {
    const detailWrap = document.querySelector(".detail-panel-wrap");
    if (detailWrap) detailWrap.scrollTop = 0;
    if (!validExplicit) {
      const master = document.querySelector(".master-panel");
      if (master && masterScrollRef.current) master.scrollTop = masterScrollRef.current;
    }
  }, [validExplicit]);

  const ctx = useMemo(() => ({ select, clearSelection, hide, unhide }), [select, clearSelection, hide, unhide]);

  return (
    <DashboardContext.Provider value={ctx}>
      <AppShell
        hasSelection={validExplicit !== null}
        masterPanel={<MasterList sections={visibleSections} selectedId={selectedId} />}
        detailPanel={
          <>
            <button type="button" className="mobile-back" onClick={clearSelection}>
              ← Danh sách
            </button>
            <DetailPanel detail={detail} />
          </>
        }
      />
    </DashboardContext.Provider>
  );
}
