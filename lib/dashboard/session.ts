/**
 * Dashboard session (SPEC §14: one password, no user accounts).
 * The cookie holds HMAC(LINK_SIGNING_SECRET, DASHBOARD_PASSWORD): nothing secret is readable from it, and
 * changing the password signs everyone out. Web Crypto, so it runs in the proxy and in route handlers alike.
 */
export const SESSION_COOKIE = 'aangan_dashboard';
export const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60;

const enc = new TextEncoder();

function base64url(bytes: ArrayBuffer): string {
  let bin = '';
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sessionToken(): Promise<string> {
  const secret = process.env.LINK_SIGNING_SECRET ?? '';
  const password = process.env.DASHBOARD_PASSWORD ?? '';
  if (!secret || !password) throw new Error('LINK_SIGNING_SECRET and DASHBOARD_PASSWORD must be set');
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return base64url(await crypto.subtle.sign('HMAC', key, enc.encode(`dashboard-session:${password}`)));
}

export async function isValidSession(token: string | null | undefined): Promise<boolean> {
  if (!token) return false;
  const expected = await sessionToken();
  if (token.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
