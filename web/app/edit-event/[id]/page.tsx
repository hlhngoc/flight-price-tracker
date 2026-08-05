import Link from "next/link";
import { notFound } from "next/navigation";
import { getEvent } from "@/lib/firestore";
import { toVnDatetimeLocalInput } from "@/lib/dateFormat";
import EditEventForm from "@/app/components/EditEventForm";

export const dynamic = "force-dynamic";

export default async function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const event = await getEvent(id);
  if (!event) notFound();

  return (
    <main>
      <Link className="back-link" href="/">
        ← Dashboard
      </Link>
      <h1>Sửa sự kiện</h1>
      <p style={{ color: "var(--muted)", fontSize: 13 }}>
        Sửa origin/destination, độ linh hoạt, khung giờ ưa thích hoặc giờ sự kiện sẽ khiến hệ thống
        xoá các route ứng viên hiện tại và nhờ AI chọn lại từ đầu. Chỉ sửa tên/địa điểm thì giữ
        nguyên route.
      </p>
      <EditEventForm event={event} datetimeLocalValue={toVnDatetimeLocalInput(event.event_datetime)} />
    </main>
  );
}
