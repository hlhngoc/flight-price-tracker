import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getRoute } from "@/lib/firestore";
import EditRouteForm from "@/app/components/EditRouteForm";

export const dynamic = "force-dynamic";

export default async function EditRoutePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const route = await getRoute(id);
  if (!route) notFound();
  // Event-linked routes are AI-picked candidate slots for that event — they
  // can only be edited by editing the event itself (which regenerates the
  // whole slot set), so send stray direct links there instead of a dead end.
  if (route.event_id) redirect(`/edit-event/${route.event_id}`);

  return (
    <main>
      <Link className="back-link" href="/">
        ← Dashboard
      </Link>
      <h1>Sửa route</h1>
      <EditRouteForm route={route} />
    </main>
  );
}
