import { NextRequest, NextResponse } from "next/server";
import { deleteEvent } from "@/lib/firestore";

export const runtime = "nodejs";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await deleteEvent(id);
  return NextResponse.json({ ok: true });
}
