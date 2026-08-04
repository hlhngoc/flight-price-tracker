import { NextRequest, NextResponse } from "next/server";
import { checkPassword, expectedSessionToken, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const password = String(form.get("password") ?? "");

  if (!checkPassword(password)) {
    return NextResponse.redirect(new URL("/login?error=1", req.url), { status: 303 });
  }

  const token = await expectedSessionToken();
  const res = NextResponse.redirect(new URL("/", req.url), { status: 303 });
  res.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return res;
}
