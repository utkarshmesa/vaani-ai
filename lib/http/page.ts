import { esc } from '@/lib/emails/html';

/** Simple confirmation page for email click endpoints (SPEC §12). */
export function htmlPage(title: string, message: string, status = 200): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Aangan Leads</title></head>
<body style="font-family:system-ui,Arial,sans-serif;max-width:560px;margin:48px auto;padding:0 16px;color:#222;line-height:1.5">
<h1 style="font-size:22px">${esc(title)}</h1>
<p>${esc(message)}</p>
<p style="color:#888;font-size:13px">Aangan Leads</p>
</body></html>`;
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
