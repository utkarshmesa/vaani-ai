/** Minimal helpers for plain, email-client-safe HTML. */

export function esc(s: string | number | null | undefined): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function button(href: string, label: string, colour = '#1f6f4a'): string {
  return `<a href="${esc(href)}" style="display:inline-block;background:${colour};color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:6px;margin:4px 8px 4px 0">${esc(label)}</a>`;
}

/** A two-column table of label/value rows; empty values are skipped. */
export function detailsTable(rows: [string, string | number | null | undefined][]): string {
  const body = rows
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#666;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:4px 0">${esc(v)}</td></tr>`)
    .join('');
  return `<table style="border-collapse:collapse;font-size:14px">${body}</table>`;
}

export function detailsText(rows: [string, string | number | null | undefined][]): string {
  return rows.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => `${k}: ${v}`).join('\n');
}

export function layout(title: string, inner: string): string {
  return `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#222;line-height:1.5;max-width:640px;margin:0 auto;padding:16px">
<h2 style="margin:0 0 12px;font-size:18px">${esc(title)}</h2>
${inner}
<p style="color:#888;font-size:12px;margin-top:24px">Sent automatically by Aangan Leads (Vaani).</p>
</body></html>`;
}
