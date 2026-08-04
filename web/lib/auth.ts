// Simple shared-password gate. Deliberately stateless (no session store) —
// the cookie value is a hash of the password + a per-deployment secret, and
// middleware just recomputes it and compares. Uses Web Crypto (`crypto.
// subtle`) rather than Node's `crypto` module so this works unmodified in
// both the Edge middleware and the Node API route runtimes.
export const SESSION_COOKIE_NAME = "ft_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function expectedSessionToken(): Promise<string> {
  const password = process.env.APP_PASSWORD ?? "";
  const secret = process.env.SESSION_SECRET ?? "";
  return sha256Hex(`ft-session:${secret}:${password}`);
}

export function checkPassword(input: string): boolean {
  return Boolean(process.env.APP_PASSWORD) && input === process.env.APP_PASSWORD;
}

export async function isValidSession(cookieValue: string | undefined): Promise<boolean> {
  if (!cookieValue) return false;
  const expected = await expectedSessionToken();
  return cookieValue === expected;
}
