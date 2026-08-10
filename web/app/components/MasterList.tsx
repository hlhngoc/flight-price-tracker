import type { MasterListRow } from "@/lib/dashboardView";
import MasterListItem from "./MasterListItem";

export interface MasterListSection {
  key: string;
  label: string;
  rows: MasterListRow[];
}

export default function MasterList({
  sections,
  selectedId,
}: {
  sections: MasterListSection[];
  selectedId: string | null;
}) {
  const hasAnyRows = sections.some((s) => s.rows.length > 0);
  if (!hasAnyRows) {
    return <p className="empty">Chưa có route nào được theo dõi.</p>;
  }

  return (
    <div className="master-list">
      {sections.map(
        (section) =>
          section.rows.length > 0 && (
            <div className="master-list-section" key={section.key}>
              <div className="master-list-section-label">{section.label}</div>
              {section.rows.map((row) => (
                <MasterListItem key={row.id} row={row} isSelected={row.id === selectedId} />
              ))}
            </div>
          )
      )}
    </div>
  );
}
