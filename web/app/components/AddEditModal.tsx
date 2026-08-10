"use client";

import { useRouter } from "next/navigation";
import { toVnDatetimeLocalInput } from "@/lib/dateFormat";
import type { EventDoc, RouteDoc } from "@/lib/types";
import Modal from "./Modal";
import EditEventForm from "./EditEventForm";
import EditRouteForm from "./EditRouteForm";
import { useToast } from "./ToastProvider";

// "Add" modes (add-event/add-route) are Stage 4 — they need AddEventForm/
// AddRouteForm extracted from app/add-event and app/add-route first. Only
// edit modes are wired for now.
export type AddEditModalProps =
  | { open: boolean; onClose: () => void; mode: "edit-event"; event: EventDoc }
  | { open: boolean; onClose: () => void; mode: "edit-route"; route: RouteDoc };

export default function AddEditModal(props: AddEditModalProps) {
  const { open, onClose, mode } = props;
  const router = useRouter();
  const { showToast } = useToast();

  function handleSuccess() {
    onClose();
    showToast("Cập nhật thành công");
    router.refresh();
  }

  return (
    <Modal open={open} onClose={onClose} title={mode === "edit-event" ? "Sửa sự kiện" : "Sửa route"} wide>
      {mode === "edit-event" ? (
        <EditEventForm
          event={props.event}
          datetimeLocalValue={toVnDatetimeLocalInput(props.event.event_datetime)}
          onSuccess={handleSuccess}
        />
      ) : (
        <EditRouteForm route={props.route} onSuccess={handleSuccess} />
      )}
    </Modal>
  );
}
