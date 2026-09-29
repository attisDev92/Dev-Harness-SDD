// GitHub Issues client for the tracker sync (RF-TRK-02/03/10). The token is
// read from GITHUB_TOKEN or GH_TOKEN and never written anywhere.

const API = 'https://api.github.com';

export function tokenFrom(env) {
  return env.GITHUB_TOKEN || env.GH_TOKEN || null;
}

export function githubClient({ repo, token, fetch = globalThis.fetch }) {
  const call = async (method, url, body) => {
    const res = await fetch(`${API}${url}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'sdd-harness',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const err = new Error(`GitHub ${method} ${url}: HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.status === 204 ? null : res.json();
  };
  const label = (spec) => `sdd:${spec}`;
  return {
    /** RF-TRK-02 */
    async check() {
      const r = await call('GET', `/repos/${repo}`);
      return { name: r.full_name, canWrite: Boolean(r.permissions?.push || r.permissions?.triage) };
    },
    async list(spec) {
      const items = [];
      for (let page = 1; page < 50; page += 1) {
        const batch = await call('GET', `/repos/${repo}/issues?labels=${encodeURIComponent(label(spec))}&state=all&per_page=100&page=${page}`);
        items.push(...batch.filter((i) => !i.pull_request));
        if (batch.length < 100) break;
      }
      return items.map((i) => ({ key: `${repo}#${i.number}`, number: i.number, title: i.title, done: i.state === 'closed' }));
    },
    async create(spec, title, body) {
      const i = await call('POST', `/repos/${repo}/issues`, { title, body, labels: [label(spec)] });
      return { key: `${repo}#${i.number}`, number: i.number };
    },
    async update(number, { title, done }) {
      await call('PATCH', `/repos/${repo}/issues/${number}`, { title, state: done ? 'closed' : 'open' });
    },
  };
}
