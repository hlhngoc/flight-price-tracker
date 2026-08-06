import Link from "next/link";
import { notFound } from "next/navigation";
import { getRoute } from "@/lib/firestore";
import EditRouteForm from "@/app/components/EditRouteForm";

export const dynamic = "force-dynamic";

export default async function EditRoutePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const route = await getRoute(id);
  if (!route) notFound();
  // Event-linked routes are AI-picked candidate slots for that event —
  // origin/destination/date/time-window can only be edited by editing the
  // event itself (which regenerates the whole slot set). But return_date
  // (round-trip) is a purely additive, AI-independent preference that IS
  // editable here regardless — so unlike before, this page no longer
  // redirects away for event-linked routes; EditRouteForm renders a
  // reduced round-trip-only form for them instead.

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
