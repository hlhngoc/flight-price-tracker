// Triggers the price-check GitHub Actions workflow via workflow_dispatch,
// scoped to specific route ids, so newly created routes get an immediate
// first price check instead of waiting for the next scheduled cron run (up
// to ~12h). Best-effort: if GH_REPO/GH_DISPATCH_TOKEN aren't configured, or
// the API call fails, this silently no-ops (just logs) — the routes are
// still tracked, just from the next scheduled run instead of right now.
const WORKFLOW_FILE = "price-check.yml";

export async function triggerPriceCheckWorkflow(routeIds: string[]): Promise<void> {
  if (routeIds.length === 0) return;

  const repo = process.env.GH_REPO; // "owner/repo"
  const token = process.env.GH_DISPATCH_TOKEN;
  if (!repo || !token) {
    console.warn("GH_REPO/GH_DISPATCH_TOKEN not set — skipping immediate price-check trigger");
    return;
  }
  const ref = process.env.GH_REF || "main";

  try {
    const resp = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${WORKFLOW_FILE}/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref, inputs: { route_ids: routeIds.join(",") } }),
    });
    if (!resp.ok) {
      console.error(`Failed to trigger price-check workflow: ${resp.status} ${await resp.text()}`);
    }
  } catch (err) {
    console.error("Failed to trigger price-check workflow:", err);
  }
}
