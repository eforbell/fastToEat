'use strict';

// Suite identity (Home Base Feature-10): the gate in front of every route in tailnet mode. Local mode is the rest of
// the suite, unchanged.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createSuiteIdentity, homeBaseUid, publicPath } = require('../lib/suite-identity');
const { listenTarget } = require('../lib/listen');
const { app, pool, setSuiteIdentityForTests } = require('../server');

const SOCKET = 'unix:/run/sovereign-apps/fast-to-eat/app.sock';
const ORIGIN = 'https://smith-home.example-tailnet.ts.net';
const TAILNET = { SOVEREIGN_AUTH_MODE: 'tailnet', SOVEREIGN_LISTEN: SOCKET, SOVEREIGN_HOMEBASE_UID: '998', APP_PUBLIC_URL: `${ORIGIN}/fte/` };
const noSnapshot = { current: () => ({ ok: false, reason: 'missing', message: 'no snapshot' }) };
const unlinked = { findLinked: async () => null };

// A directory snapshot as the library hands it over: members by stable user ID.
function snapshotOf(members) {
  const list = members.map((member) => ({ status: 'active', epoch: 1, apps: ['fast-to-eat'], role: 'parent', ...member }));
  return { current: () => ({ ok: true, snapshot: { members: list, byUserId: new Map(list.map((member) => [member.userId, member])) } }) };
}
const as = (userId, login) => ({ 'x-sovereign-user-id': userId, 'x-sovereign-login': login });
const PARENT = { userId: 'u-parent', memberId: 'm_parent', login: 'parent@example.com', name: 'Parent' };
const KID = { userId: 'u-kid', memberId: 'm_kid', login: 'kid@example.com', name: '<b>Kid</b>', role: 'kid' };
const PARENT_HEADERS = as('u-parent', 'parent@example.com');
const KID_HEADERS = as('u-kid', 'kid@example.com');

// family_members as Postgres would answer what the gate, the member list and setup's status ask.
class MembersDb {
  constructor(rows) { this.rows = rows; }
  async query(sql, params = []) {
    if (sql.includes('FROM family_members WHERE suite_member_id = $1')) return { rows: this.rows.filter((row) => row.suite_member_id === params[0]) };
    if (sql.includes('FROM family_members ORDER BY id')) return { rows: this.rows.map((row) => ({ ...row })) };
    if (sql.includes('COUNT(*)::int AS count FROM family_members')) return { rows: [{ count: this.rows.length }] };
    throw new Error(`Unexpected SQL: ${sql}`);
  }
}

const ORIGINAL_QUERY = pool.query;
async function withServer(env, db, fn) {
  setSuiteIdentityForTests(env.env, env.options);
  pool.query = db.query.bind(db);
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise((resolve) => server.once('listening', resolve));
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    pool.query = ORIGINAL_QUERY;
    setSuiteIdentityForTests({});
  }
}
const tailnet = (members) => ({ env: TAILNET, options: { reader: snapshotOf(members) } });
const household = () => new MembersDb([
  { id: 1, name: 'Parent', role: 'parent', avatar_emoji: '👤', suite_member_id: 'm_parent' },
  { id: 2, name: 'Kid', role: 'kid', avatar_emoji: '👤', suite_member_id: 'm_kid' },
]);

// A request with exactly the path and headers given (fetch would normalize the path and set fetch metadata itself).
function raw(base, method, route, headers = {}, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}${route}`, { method, headers }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('no SOVEREIGN_AUTH_MODE means local: installs from before Home Base set one keep the picker', () => {
  assert.equal(createSuiteIdentity({}).mode, 'local');
  assert.equal(createSuiteIdentity({ SOVEREIGN_AUTH_MODE: 'local' }).mode, 'local');
  assert.equal(createSuiteIdentity({}).tailnet, false);
});

test('a configuration the app cannot trust refuses to start', () => {
  for (const mode of ['', ' ', 'Tailnet', 'off', 'true']) {
    assert.throws(() => createSuiteIdentity({ ...TAILNET, SOVEREIGN_AUTH_MODE: mode }, unlinked), /SOVEREIGN_AUTH_MODE/, `mode '${mode}'`);
  }
  // Identity headers are trusted only on the app's socket, which only nginx can reach.
  for (const listen of [undefined, '', '127.0.0.1:3005']) {
    assert.throws(() => createSuiteIdentity({ ...TAILNET, SOVEREIGN_LISTEN: listen }, unlinked), /SOVEREIGN_LISTEN/);
  }
  for (const uid of [undefined, '', '0', '-1', '01', '1e3', '4294967295', '99999999999', 'homebase']) {
    assert.throws(() => createSuiteIdentity({ ...TAILNET, SOVEREIGN_HOMEBASE_UID: uid }, unlinked), /SOVEREIGN_HOMEBASE_UID/, `uid '${uid}'`);
  }
  for (const url of [undefined, '', 'fte', 'http://smith-home.example-tailnet.ts.net/fte/']) {
    assert.throws(() => createSuiteIdentity({ ...TAILNET, APP_PUBLIC_URL: url }, unlinked), /APP_PUBLIC_URL/, `url '${url}'`);
  }
  // The link page redirect is built on the path, so it must stay on this host.
  for (const url of [`${ORIGIN}//evil.example/`, `${ORIGIN}/fte//x/`, `${ORIGIN}/f%2Fte/`]) {
    assert.throws(() => createSuiteIdentity({ ...TAILNET, APP_PUBLIC_URL: url }, unlinked), /APP_PUBLIC_URL/, `url '${url}'`);
  }
  for (const [url, path] of [[`${ORIGIN}/fte/`, '/fte/'], [`${ORIGIN}/fte`, '/fte/'], [`${ORIGIN}/`, '/']]) {
    assert.equal(publicPath(url), path);
  }
  assert.equal(homeBaseUid('998'), 998);
  assert.throws(() => createSuiteIdentity(TAILNET), /find linked members/);
  assert.equal(createSuiteIdentity(TAILNET, unlinked).mode, 'tailnet');
});

test('tailnet mode always listens on the socket: the identity headers are trusted only there', () => {
  // The server listens where lib/listen.js says. Every configuration tailnet mode accepts names a socket there, and a
  // TCP listener (HOST/PORT) is never chosen while SOVEREIGN_LISTEN is set: a local process could forge the headers.
  assert.deepEqual(listenTarget({ ...TAILNET, HOST: '127.0.0.1', PORT: '3005' }), { socket: '/run/sovereign-apps/fast-to-eat/app.sock' });
  for (const listen of ['unix:/run/sovereign-apps/fast-to-eat/app.sock', 'unix:/tmp/x.sock']) {
    const env = { ...TAILNET, SOVEREIGN_LISTEN: listen };
    assert.equal(createSuiteIdentity(env, unlinked).mode, 'tailnet');
    assert.ok(listenTarget(env).socket, listen);
  }
});

test('tailnet mode takes writes only as JSON from the app\'s own origin', async () => {
  await withServer(tailnet([PARENT]), new MembersDb([{ id: 1, name: 'Parent', role: 'parent', suite_member_id: null }]), async (base) => {
    // Setup is a write an unlinked parent may reach; once a household exists it refuses, after the guard.
    const setup = (headers) => fetch(`${base}/api/bootstrap/household`, { method: 'POST', headers: { ...PARENT_HEADERS, ...headers }, body: '{}' });
    const refusals = [
      [{}, 'origin_missing'],
      [{ origin: 'https://smith-pulse.example-tailnet.ts.net', 'content-type': 'application/json' }, 'origin_mismatch'],
      [{ origin: `${ORIGIN}/`, 'content-type': 'application/json' }, 'origin_mismatch'],
      [{ origin: ORIGIN, 'sec-fetch-site': 'same-site', 'content-type': 'application/json' }, 'fetch_site'],
      [{ origin: ORIGIN }, 'content_type'],
      [{ origin: ORIGIN, 'content-type': 'text/plain' }, 'content_type'],
      [{ origin: ORIGIN, 'content-type': 'application/x-www-form-urlencoded' }, 'content_type'],
      [{ origin: ORIGIN, 'content-type': 'multipart/form-data; boundary=x' }, 'content_type'],
    ];
    for (const [headers, reason] of refusals) {
      const res = await setup(headers);
      assert.equal(res.status, 403, reason);
      assert.equal(res.headers.get('cache-control'), 'no-store', reason);
      assert.equal((await res.json()).reason, reason);
    }
    const res = await setup({ origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' });
    assert.equal(res.status, 409, 'through the guard and the gate to the handler');
    assert.equal((await res.json()).code, 'household_already_initialized');
    // The guard sees every spelling: a write to the health path is still a write.
    for (const route of ['/api/health', '/API/fast/start', '/api/fast/start/', '//api/fast/start']) {
      const write = await raw(base, 'POST', route, { ...PARENT_HEADERS, 'content-type': 'text/plain' }, '{}');
      assert.equal(write.status, 403, route);
      assert.equal(write.json().reason, 'origin_missing', route);
    }
  });
});

test('tailnet mode lets in only a household member with access whom a parent has linked', async () => {
  const members = [
    PARENT,
    KID,
    { userId: 'u-away', memberId: 'm_away', login: 'away@example.com', name: 'Away', status: 'disabled' },
    { userId: 'u-other', memberId: 'm_other', login: 'other@example.com', name: 'Other', apps: ['family-plan'] },
    { userId: 'u-new', memberId: 'm_new', login: 'new@example.com', name: 'New kid', role: 'kid' },
  ];
  await withServer(tailnet(members), household(), async (base) => {
    const get = (route, headers = {}) => fetch(`${base}${route}`, { headers, redirect: 'manual' });
    // Linked: through to the app, parent and kid alike.
    assert.equal((await get('/api/members', PARENT_HEADERS)).status, 200);
    assert.equal((await get('/api/members', KID_HEADERS)).status, 200);
    assert.equal((await get('/calendar', PARENT_HEADERS)).status, 200);
    assert.equal((await get('/calendar', KID_HEADERS)).status, 200);

    const refused = [
      [{}, 'not_member'],                                                     // no identity: tagged device, lookup failed
      [as('u-parent', 'someone@example.com'), 'not_member'],                  // the login must match the user ID
      [as('u-nobody', 'nobody@example.com'), 'not_member'],                   // not in the household
      [as('u-away', 'away@example.com'), 'not_member'],                       // disabled
      [as('u-other', 'other@example.com'), 'not_member'],                     // no access to Fast to Eat
      [{ 'x-sovereign-user-id': 'u-parent', 'x-sovereign-login': 'tagged-devices' }, 'not_member'],
      [as('u-new', 'new@example.com'), 'not_linked'],                         // a kid nobody has linked yet
    ];
    for (const [headers, code] of refused) {
      for (const route of ['/api/members', '/API/members', '/api/members/', '/Api/Family/Leaderboard', '/api/me/1/status']) {
        const api = await get(route, headers);
        assert.equal(api.status, 403, `${code} ${route}`);
        assert.equal((await api.json()).code, code, route);
        assert.equal(api.headers.get('cache-control'), 'no-store');
      }
      for (const route of ['/', '/calendar', '/progress', '/settings', '/login', '/index.html', '/settings.html', '/link', '/setup']) {
        const page = await get(route, headers);
        assert.equal(page.status, 403, `${code} ${route}`);
        assert.match(page.headers.get('content-type'), /text\/html/);
        assert.equal(page.headers.get('cache-control'), 'no-store');
      }
    }
    // The page names who is asking, as text.
    const kidPage = await (await get('/calendar', as('u-new', 'new@example.com'))).text();
    assert.match(kidPage, /Ask a parent to link you/);
    assert.match(kidPage, /New kid/);
    // Health and page assets are open; data and pages are not.
    assert.equal((await get('/api/health')).status, 200);
    assert.equal((await get('/style.css')).status, 200);
    assert.equal((await get('/app.js')).status, 200);
    assert.equal((await get('/favicon.svg')).status, 200);
    assert.equal((await get('/favicon.ico')).status, 200);
    assert.equal((await get('/sovereign-fonts.css')).status, 200);
    assert.equal((await fetch(`${base}/style.css`, { method: 'HEAD' })).status, 200);
    // Just outside them: a path under the health path, a page, data, and an asset-like name below the root.
    for (const route of ['/api/health/x', '/api/healthz', '/api/bootstrap', '/api/family/leaderboard', '/index.html', '/login.html', '/x/style.css', '/style.css.map']) {
      assert.equal((await get(route)).status, 403, route);
    }
    // An asset read only: any other method needs a member (and the guard's JSON first).
    assert.equal((await fetch(`${base}/style.css`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' } })).status, 403);
  });

  // Without a snapshot nobody is a member: say so, and that it's not the asker's doing.
  await withServer({ env: TAILNET, options: { reader: noSnapshot } }, household(), async (base) => {
    const res = await fetch(`${base}/api/members`, { headers: PARENT_HEADERS });
    assert.equal(res.status, 503);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal((await res.json()).code, 'directory');
    const page = await fetch(`${base}/calendar`, { headers: PARENT_HEADERS });
    assert.equal(page.status, 503);
    assert.match(await page.text(), /tell whoever runs Home Base/);
  });

  // Local mode ignores identity headers entirely.
  await withServer({ env: {} }, household(), async (base) => {
    assert.equal((await fetch(`${base}/api/members`)).status, 200);
    assert.equal((await fetch(`${base}/api/members`, { headers: as('u-nobody', 'nobody@example.com') })).status, 200);
  });
});

test('a kid\'s account opens only a kid\'s row, checked on every request', async () => {
  // Linked as a parent row; the directory has since made them a kid.
  const db = new MembersDb([{ id: 1, name: 'Parent', role: 'parent', suite_member_id: 'm_kid' }]);
  await withServer(tailnet([KID]), db, async (base) => {
    for (const route of ['/api/members', '/api/me/1/status', '/API/members/']) {
      const res = await fetch(`${base}${route}`, { headers: KID_HEADERS });
      assert.equal(res.status, 403, route);
      assert.equal((await res.json()).code, 'stale_link');
    }
    const page = await fetch(`${base}/calendar`, { headers: KID_HEADERS });
    assert.equal(page.status, 403);
    const text = await page.text();
    assert.match(text, /Ask a parent to link you again/);
    // The page names who is asking, as text: a name is never markup.
    assert.match(text, /&lt;b&gt;Kid&lt;\/b&gt;/);
    assert.doesNotMatch(text, /<b>Kid/);
  });
  // The same row and account, while the directory still says parent: through.
  await withServer(tailnet([{ ...KID, role: 'parent' }]), db, async (base) => {
    assert.equal((await fetch(`${base}/api/members`, { headers: KID_HEADERS })).status, 200);
  });
});

test('a parent nobody has linked reaches the link page and setup, and nothing about the household', async () => {
  const db = new MembersDb([{ id: 1, name: 'Parent', role: 'parent', suite_member_id: null }]);
  await withServer(tailnet([PARENT]), db, async (base) => {
    const get = (route) => fetch(`${base}${route}`, { headers: PARENT_HEADERS, redirect: 'manual' });
    for (const route of ['/', '/calendar', '/progress', '/settings', '/login', '/index.html', '/LINK', '/link/', '/setup/', '/Setup']) {
      const res = await get(route);
      assert.equal(res.status, 303, route);
      assert.equal(res.headers.get('location'), '/fte/link', route);
    }
    for (const route of ['/api/members', '/api/family/leaderboard', '/api/me/1/status', '/api/suite/links/01', '/api/suite/links/1/x', '/API/bootstrap', '/api/bootstrap/', '/api/suite/links/']) {
      const res = await get(route);
      assert.equal(res.status, 403, route);
      assert.equal((await res.json()).code, 'not_linked', route);
    }
    // Writes outside them too, after the guard.
    const start = await fetch(`${base}/api/fast/start`, { method: 'POST', headers: { ...PARENT_HEADERS, origin: ORIGIN, 'content-type': 'application/json' }, body: '{"member_id":1}' });
    assert.equal(start.status, 403);
    assert.equal((await start.json()).code, 'not_linked');
    // Admitted: the link page and its API (the next commit adds them, so 404 here means the gate let them through).
    assert.equal((await get('/link')).status, 404);
    assert.equal((await get('/api/suite/links')).status, 404);
    assert.equal((await get('/api/suite/links/1')).status, 404);
    // Setup redirects home once a household exists; the gate then sends them to the link page.
    assert.equal((await get('/setup')).headers.get('location'), './');
    // Setup's status says only whether a household is still needed: no counts.
    const status = await get('/api/bootstrap');
    assert.equal(status.status, 200);
    assert.equal(status.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await status.json(), { app: 'fast-to-eat', bootstrap: { needs_household: false } });
  });
  // Before there is a household: setup's page and its status, still without counts.
  await withServer(tailnet([PARENT]), new MembersDb([]), async (base) => {
    const page = await fetch(`${base}/setup`, { headers: PARENT_HEADERS, redirect: 'manual' });
    assert.equal(page.status, 200);
    const status = await (await fetch(`${base}/api/bootstrap`, { headers: PARENT_HEADERS })).json();
    assert.deepEqual(status, { app: 'fast-to-eat', bootstrap: { needs_household: true } });
  });
  // Linked, the full status as before.
  await withServer(tailnet([PARENT]), household(), async (base) => {
    const body = await (await fetch(`${base}/api/bootstrap`, { headers: PARENT_HEADERS })).json();
    assert.equal(body.counts.family_members, 2);
  });
});

test('the API is for Fast to Eat\'s own pages: a navigation to it is refused, in any spelling', async () => {
  await withServer(tailnet([PARENT]), household(), async (base) => {
    const navigate = (route) => raw(base, 'GET', route, { ...PARENT_HEADERS, 'sec-fetch-mode': 'navigate' });
    for (const route of ['/api/members', '/API/Members', '/api/members/', '/api/family/leaderboard', '/api/me/1/status', '/api/bootstrap', '/api/suite/links', '/api']) {
      const res = await navigate(route);
      assert.equal(res.status, 403, route);
      assert.equal(res.headers['cache-control'], 'no-store', route);
      assert.equal(res.json().code, 'not_a_page', route);
    }
    // The pages' own fetches are not navigations, and pages are for navigating to.
    assert.equal((await raw(base, 'GET', '/api/members', { ...PARENT_HEADERS, 'sec-fetch-mode': 'cors' })).status, 200);
    assert.equal((await navigate('/calendar')).status, 200);
    // The health probe has no member and no fetch metadata; open either way.
    assert.equal((await navigate('/api/health')).status, 200);
  });
});
