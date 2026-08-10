"use client";

import { useState } from "react";
import type { EventDoc, RouteDoc } from "@/lib/types";
import AddEditModal from "./AddEditModal";
import DeleteEventButton from "./DeleteEventButton";
import DeleteRouteButton from "./DeleteRouteButton";

export type ActionBarProps =
  | { kind: "event"; event: EventDoc }
  | { kind: "route"; route: RouteDoc; eventName: string | null };

// Ghost Edit/Delete icon buttons for the Detail Panel's action bar. Both
// buttons share the same .icon-button styling — Delete uses
// DeleteRouteButton/DeleteEventButton's variant="icon" so it renders as a
// 🗑️ ghost button here instead of its default text-link look (that default
// is still what MasterListItem's kebab dropdown uses, styled to match its
// "Sửa" text menu item — this component isn't reused there).
export default function ActionBar(props: ActionBarProps) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="action-bar">
      <button className="icon-button" type="button" title="Sửa" aria-label="Sửa" onClick={() => setEditing(true)}>
        ✏️
      </button>
      {props.kind === "event" ? (
        <DeleteEventButton eventId={props.event.id} variant="icon" />
      ) : (
        <DeleteRouteButton routeId={props.route.id} eventName={props.eventName} variant="icon" />
      )}
      {props.kind === "event" ? (
        <AddEditModal open={editing} onClose={() => setEditing(false)} mode="edit-event" event={props.event} />
      ) : (
        <AddEditModal open={editing} onClose={() => setEditing(false)} mode="edit-route" route={props.route} />
      )}
    </div>
  );
}
