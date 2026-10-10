export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const next = typeof q.next === 'string' ? q.next : '/dashboard';
  return (
    <main className="login card">
      <div className="brand" style={{ marginBottom: 16 }}>
        <span className="brand-mark">A</span>
        <span>Aangan Leads<small>Vaani enquiry dashboard</small></span>
      </div>
      <p className="sub" style={{ color: 'var(--muted)', marginTop: 0 }}>Enter the dashboard password.</p>
      {q.error ? <p className="badge b-bad">That password is not right.</p> : null}
      <form method="post" action="/api/login">
        <input type="hidden" name="next" value={next} />
        <label htmlFor="password" style={{ fontSize: 13, color: 'var(--muted)' }}>Password</label>
        <input id="password" name="password" type="password" required autoFocus />
        <button type="submit" className="btn primary" style={{ width: '100%', padding: '10px 12px' }}>Open dashboard</button>
      </form>
    </main>
  );
}
