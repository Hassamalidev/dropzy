import { useState } from 'react';
import { formatBytes } from '../../lib/format';
import { API_URL } from '../../lib/site';
import { t } from '../../strings/en';

// Small admin page (§14.7). The token lives in memory only — never in storage.

type Overview = {
  usage: {
    day: string;
    usage: { class_a: number; class_b: number; upload_bytes: number };
    storedBytes: number;
    reservedBytes: number;
    limits: { maxStored: number; classA: number; classB: number };
    status: string;
    blocks: number;
  };
  reports: { id: string; ref: string; item_id: string; reason: string; note: string | null; created_at: number }[];
  feedback: { id: string; type: string; message: string; email: string | null; created_at: number }[];
};

export default function AdminApp() {
  const [token, setToken] = useState('');
  const [data, setData] = useState<Overview | null>(null);
  const [err, setErr] = useState('');

  const call = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
      credentials: 'omit',
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    return json.data;
  };
  const load = async () => {
    setErr('');
    try {
      setData(await call('/v1/admin/overview'));
    } catch (e) {
      setErr(String((e as Error).message));
    }
  };
  const act = async (id: string, action: string) => {
    await call(`/v1/admin/reports/${id}`, { method: 'POST', body: JSON.stringify({ action }) }).catch((e) => setErr(e.message));
    await load();
  };

  if (!data) {
    return (
      <form
        className="card mx-auto my-10 flex max-w-sm flex-col gap-3 p-6"
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <h1 className="text-xl font-semibold">{t.admin.title}</h1>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {t.admin.token}
          <input type="password" autoComplete="off" className="input" value={token} onChange={(e) => setToken(e.target.value)} />
        </label>
        <button type="submit" className="btn-primary">
          {t.admin.signIn}
        </button>
        {err && <p role="alert" className="text-sm text-slate-950">{err}</p>}
      </form>
    );
  }

  const u = data.usage;
  const rows: [string, string][] = [
    ['Status', u.status],
    ['Stored', `${formatBytes(u.storedBytes)} / ${formatBytes(u.limits.maxStored)} (+${formatBytes(u.reservedBytes)} reserved)`],
    ['Class A today', `${u.usage.class_a} / ${u.limits.classA}`],
    ['Class B today', `${u.usage.class_b} / ${u.limits.classB}`],
    ['Uploaded today', formatBytes(u.usage.upload_bytes)],
    ['Active blocks', String(u.blocks)],
  ];

  return (
    <div className="my-8 flex flex-col gap-6">
      <section className="card p-5">
        <h2 className="mb-3 text-lg font-semibold">
          {t.admin.usage} · {u.day}
        </h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-slate-500">{k}</dt>
              <dd className="font-mono">{v}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="card p-5">
        <h2 className="mb-3 text-lg font-semibold">{t.admin.reports}</h2>
        {data.reports.length === 0 && <p className="text-sm text-slate-500">{t.admin.empty}</p>}
        <ul className="flex flex-col gap-3">
          {data.reports.map((r) => (
            <li key={r.id} className="rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-700">
              <p className="font-medium">
                {r.reason} · {new Date(r.created_at).toLocaleString()}
              </p>
              {r.note && <p className="mt-1 whitespace-pre-wrap text-slate-600 dark:text-slate-300">{r.note}</p>}
              <p className="mt-1 break-all">
                <a className="link font-mono text-xs" href={`/f/${r.ref}`} target="_blank" rel="noopener noreferrer">
                  /f/{r.ref}
                </a>
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className="btn-secondary min-h-9" onClick={() => act(r.id, 'delete')}>
                  {t.admin.deleteItem}
                </button>
                <button type="button" className="btn-secondary min-h-9" onClick={() => act(r.id, 'block24')}>
                  {t.admin.block24}
                </button>
                <button type="button" className="btn-secondary min-h-9" onClick={() => act(r.id, 'block7d')}>
                  {t.admin.block7d}
                </button>
                <button type="button" className="btn-ghost min-h-9" onClick={() => act(r.id, 'dismiss')}>
                  {t.admin.dismiss}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section className="card p-5">
        <h2 className="mb-3 text-lg font-semibold">{t.admin.feedback}</h2>
        {data.feedback.length === 0 && <p className="text-sm text-slate-500">{t.admin.empty}</p>}
        <ul className="flex flex-col gap-3">
          {data.feedback.map((f) => (
            <li key={f.id} className="rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-700">
              <p className="text-xs text-slate-500">
                {f.type} · {new Date(f.created_at).toLocaleString()} {f.email && `· ${f.email}`}
              </p>
              <p className="mt-1 whitespace-pre-wrap">{f.message}</p>
              <button
                type="button"
                className="btn-ghost mt-1 min-h-9"
                onClick={async () => {
                  await call(`/v1/admin/feedback/${f.id}`, { method: 'DELETE' }).catch(() => {});
                  await load();
                }}
              >
                {t.admin.dismiss}
              </button>
            </li>
          ))}
        </ul>
      </section>
      {err && <p role="alert" className="text-sm text-slate-950">{err}</p>}
    </div>
  );
}
