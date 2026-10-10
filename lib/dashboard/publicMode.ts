/**
 * DASHBOARD_PUBLIC=1 opens the dashboard without a password (e.g. for a reviewer). Off by default.
 * Kept free of next/headers so the proxy can import it.
 */
export function isPublicDashboard(): boolean {
  return process.env.DASHBOARD_PUBLIC === '1';
}
