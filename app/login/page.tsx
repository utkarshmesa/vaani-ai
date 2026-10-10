export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const next = typeof q.next === 'string' ? q.next : '/dashboard';
  return (
    <main style={{ maxWidth: 360, margin: '64px auto' }}>
      <h1 style={{ fontSize: 22 }}>Aangan Leads</h1>
      <p>Enter the dashboard password.</p>
      {q.error ? <p style={{ color: '#c53030' }}>That password is not right.</p> : null}
      <form method="post" action="/api/login">
        <input type="hidden" name="next" value={next} />
        <label htmlFor="password" style={{ display: 'block', marginBottom: 6 }}>Password</label>
        <input id="password" name="password" type="password" required autoFocus
          style={{ width: '100%', padding: 10, fontSize: 16, boxSizing: 'border-box', marginBottom: 12 }} />
        <button type="submit" style={{ padding: '10px 18px', fontSize: 16, background: '#1f6f4a', color: '#fff', border: 0, borderRadius: 6 }}>
          Open dashboard
        </button>
      </form>
    </main>
  );
}
