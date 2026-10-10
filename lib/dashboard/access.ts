import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { isPublicDashboard } from './publicMode';
import { isValidSession, SESSION_COOKIE } from './session';

export { isPublicDashboard };

/** Pages call this (the proxy is only an optimistic gate): public mode, or a valid session, or → /login. */
export async function requireDashboardAccess(nextPath: string): Promise<void> {
  if (isPublicDashboard()) return;
  const store = await cookies();
  if (!(await isValidSession(store.get(SESSION_COOKIE)?.value))) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
}

/** "+919800000101" → "+91 98••••• 101". Values that aren't phone numbers are returned unchanged. */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 8 || /[a-z]/i.test(phone)) return phone;
  const national = digits.length > 10 ? digits.slice(-10) : digits;
  const country = digits.length > 10 ? `+${digits.slice(0, digits.length - 10)} ` : '';
  return `${country}${national.slice(0, 2)}••••• ${national.slice(-3)}`;
}

/** Phone numbers are shown in full behind the password and masked when the dashboard is public. */
export function showPhone(phone: string | null | undefined): string | null {
  return isPublicDashboard() ? maskPhone(phone) : phone ?? null;
}

/** Mask phone numbers inside free text (email subjects, summaries) when the dashboard is public. */
export function showText(text: string | null | undefined): string | null {
  if (!text) return text ?? null;
  return isPublicDashboard() ? text.replace(/\+?\d[\d\s-]{7,16}\d/g, (m) => maskPhone(m) ?? m) : text;
}
