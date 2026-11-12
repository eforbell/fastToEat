'use strict';

// Suite identity, roles: in tailnet mode every linked member, parent or kid, acts only as their own linked row. A
// member ID in the path must be theirs, one in a body is replaced by theirs, and a fast session they edit must be
// theirs. The family board stays visible to everyone. Local mode keeps the picker, as before.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { app, pool, setSuiteIdentityForTests } = require('../server');

const ORIGIN = 'https://smith-home.example-tailnet.ts.net';
const TAILNET = {
  SOVEREIGN_AUTH_MODE: 'tailnet',
  SOVEREIGN_LISTEN: 'unix:/run/sovereign-apps/fast-to-eat/app.sock',
  SOVEREIGN_HOMEBASE_UID: '998',
  APP_PUBLIC_URL: `${ORIGIN}/fte/`,
};
function snapshotOf(members) {
  const list = members.map((member) => ({ status: 'active', epoch: 1, apps: ['fast-to-eat'], role: 'parent', ...member }));
  return { current: () => ({ ok: true, snapshot: { members: list, byUserId: new Map(list.map((member) => [member.userId, member])) } }) };
}
const as = (userId, login) => ({ 'x-sovereign-user-id': userId, 'x-sovereign-login': login });
const PARENT_HEADERS = as('u-parent', 'parent@example.com');
const KID_HEADERS = as('u-kid', 'kid@example.com');
const NEW_PARENT_HEADERS = as('u-new', 'new@example.com');
const NEW_KID_HEADERS = as('u-newkid', 'newkid@example.com');
const MEMBERS = [
  { userId: 'u-parent', memberId: 'm_parent', login: 'parent@example.com', name: 'Parent' },
  { userId: 'u-kid', memberId: 'm_kid', login: 'kid@example.com', name: 'Kid', role: 'kid' },
  { userId: 'u-new', memberId: 'm_new', login: 'new@example.com', name: 'New parent' },
  { userId: 'u-newkid', memberId: 'm_newkid', login: 'newkid@example.com', name: 'New kid', role: 'kid' },
];
const PARENT_ID = 1;
const KID_ID = 2;
const PLAN = { plan: '16:8', eat_window_start_local: '12:00', timezone: 'America/Los_Angeles', reminders_enabled: true };

// Postgres as the gate and the fasting routes ask it; every query's parameters are recorded, so a test can see whose
// rows a request read or wrote.
class Db {
  constructor(rows) {
    this.rows = rows || [
      { id: PARENT_ID, name: 'Parent', role: 'parent', avatar_emoji: '🧑', suite_member_id: 'm_parent' },
      { id: KID_ID, name: 'Kid', role: 'kid', avatar_emoji: '🧒', suite_member_id: 'm_kid' },
    ];
    // One finished fast each, ended an hour ago.
    const started = new Date(Date.now() - 18 * 3600000);
    const ended = new Date(Date.now() - 3600000);
    this.sessions = [
      { id: 10, member_id: PARENT_ID, started_at: started, ended_at: ended, planned_duration_hours: 16 },
      { id: 20, member_id: KID_ID, started_at: started, ended_at: ended, planned_duration_hours: 16 },
    ];
    this.queries = [];
  }
  async query(sql, params = []) {
    sql = sql.replace(/\s+/g, ' ').trim();
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [] };
    if (sql.includes('FROM family_members WHERE suite_member_id = $1')) return { rows: this.rows.filter((row) => row.suite_member_id === params[0]) };
    this.queries.push({ sql, params });
    if (sql.includes('COUNT(*)::int AS count FROM family_members')) return { rows: [{ count: this.rows.length }] };
    if (sql.includes('FROM family_members')) return { rows: this.rows.map((row) => ({ ...row })) };
    if (sql.startsWith('INSERT INTO family_members')) {
      const row = { id: this.rows.length + 1, name: params[0], role: params[1], avatar_emoji: params[2] };
      this.rows.push(row);
      return { rows: [row] };
    }
    if (sql.includes('FROM fast_plans WHERE member_id = $1') || sql.startsWith('UPDATE fast_plans')) {
      return { rows: [{ member_id: params[0], ...PLAN }] };
    }
    if (sql.includes('FROM fast_sessions WHERE id = $1')) return { rows: this.sessions.filter((s) => s.id === params[0]) };
    if (sql.includes('FROM fast_sessions WHERE member_id = $1 AND ended_at IS NULL')) {
      return { rows: this.sessions.filter((s) => s.member_id === params[0] && !s.ended_at) };
    }
    if (sql.startsWith('INSERT INTO fast_sessions')) {
      const session = { id: 30 + this.sessions.length, member_id: params[0], started_at: new Date(), ended_at: null, planned_duration_hours: params[1] };
      this.sessions.push(session);
      return { rows: [session] };
    }
    if (sql.startsWith('UPDATE fast_sessions')) {
      const session = this.sessions.find((s) => s.id === params[0]);
      if (sql.includes('ended_at = $2,')) session.ended_at = params[1];
      return { rows: [{ ...session }] };
    }
    return { rows: [] };
  }
  // Every member ID a query was given as its first parameter, for the tables keyed by member.
  membersTouched() {
    return this.queries.filter((q) => /\bmember_id = \$1\b|^INSERT INTO (fast_sessions|weight_checkins|member_weight_preferences|member_notification_channels|daily_fast_log|fast_plans)/.test(q.sql))
      .map((q) => q.params[0]);
  }
}

const ORIGINAL_QUERY = pool.query;
const ORIGINAL_CONNECT = pool.connect;
async function withServer(env, db, fn) {
  setSuiteIdentityForTests(env, env.SOVEREIGN_AUTH_MODE ? { reader: snapshotOf(MEMBERS) } : {});
  pool.query = db.query.bind(db);
  // Transactions (ending or adjusting a fast, setup) use a client: the same stand-in.
  pool.connect = async () => ({ query: db.query.bind(db), release() {} });
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    // Raw requests: the exact path, encoded or doubled, reaches the server as written.
    const call = (method, route, headers, body) => new Promise((resolve, reject) => {
      const write = method !== 'GET' && method !== 'HEAD';
      const req = http.request(`${base}${route}`, {
        method,
        headers: { ...headers, ...(write ? { origin: ORIGIN, 'content-type': 'application/json' } : {}) },
      }, (res) => {
        let text = '';
        res.on('data', (chunk) => { text += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) }));
      });
      req.on('error', reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
    await fn(call);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    pool.query = ORIGINAL_QUERY;
    pool.connect = ORIGINAL_CONNECT;
    setSuiteIdentityForTests({});
  }
}

// Every route that names a member in its path, with a body for the writes.
const ME_ROUTES = [
  ['GET', 'plan'], ['PUT', 'plan', { plan: '14:10' }],
  ['GET', 'weight-goal'], ['PUT', 'weight-goal', { goal_type: 'maintain' }],
  ['GET', 'weight-checkins'], ['POST', 'weight-checkins', { weight_lbs: 150 }],
  ['GET', 'status'], ['GET', 'calendar?month=2026-11'], ['GET', 'streak'],
  ['GET', 'notifications'], ['PUT', 'notifications', { enabled: true, target_secret: 'secret' }],
];

test('everyone, parent or kid, reads and changes only their own plan, weight, fasts and notifications', async () => {
  for (const [who, headers, own, other] of [['parent', PARENT_HEADERS, PARENT_ID, KID_ID], ['kid', KID_HEADERS, KID_ID, PARENT_ID]]) {
    const db = new Db();
    await withServer(TAILNET, db, async (call) => {
      for (const [method, tail, body] of ME_ROUTES) {
        const theirs = await call(method, `/api/me/${other}/${tail}`, headers, body);
        assert.equal(theirs.status, 403, `${who} ${method} another's ${tail}`);
        assert.equal(theirs.headers['cache-control'], 'no-store');
        assert.equal(theirs.json().code, 'not_yours');
      }
      assert.deepEqual(db.queries, [], `${who}: nothing read or written for a refused request`);
      for (const [method, tail, body] of ME_ROUTES) {
        const mine = await call(method, `/api/me/${own}/${tail}`, headers, body);
        assert.ok(mine.status >= 200 && mine.status < 300, `${who} ${method} own ${tail}: ${mine.status} ${mine.text}`);
      }
      assert.ok(db.membersTouched().length > 0);
      assert.deepEqual([...new Set(db.membersTouched())], [own], `${who}: only their own rows`);
    });
  }
});

test('another member\'s ID is refused in every spelling that reaches the route', async () => {
  const db = new Db();
  await withServer(TAILNET, db, async (call) => {
    const spellings = [
      '/API/me/2/plan', '/api/ME/2/Plan', '/api/me/2/plan/', '/api/me/02/plan', '/api/me/2.0/plan', '/api/me/%32/plan',
      '/api/me/+2/plan', '/api/me/%202/plan', '/api/me/2e0/plan', '/api/me/0x2/plan', '/api/me/abc/plan', '/api/me/1%2F..%2F2/plan',
      '/api/me/2/status/', '/Api/Me/2/Status', '/api/me/2/notifications', '/api/me/2/weight-checkins?range=quarter',
    ];
    for (const route of spellings) {
      const res = await call('GET', route, PARENT_HEADERS);
      assert.equal(res.status, 403, route);
      assert.equal(res.json().code, 'not_yours', route);
    }
    for (const route of ['/API/me/2/plan', '/api/me/02/plan/', '/api/me/%32/notifications']) {
      const res = await call('PUT', route, PARENT_HEADERS, { plan: '12:12', enabled: true, target_secret: 'x' });
      assert.equal(res.status, 403, route);
      assert.equal(res.json().code, 'not_yours', route);
    }
    assert.deepEqual(db.queries, []);
    // The parent's own ID, spelled differently, is still theirs.
    for (const route of ['/API/me/1/plan', '/api/me/01/plan/', '/api/me/%31/status']) {
      assert.equal((await call('GET', route, PARENT_HEADERS)).status, 200, route);
    }
  });
});

test('a member ID in a body is replaced by the requester\'s own; a fast session they adjust must be theirs', async () => {
  for (const [who, headers, own, other] of [['parent', PARENT_HEADERS, PARENT_ID, KID_ID], ['kid', KID_HEADERS, KID_ID, PARENT_ID]]) {
    const db = new Db();
    await withServer(TAILNET, db, async (call) => {
      // Starting a fast "for" someone else starts the requester's own.
      const start = await call('POST', '/api/fast/start', headers, { member_id: other });
      assert.equal(start.status, 201, `${who} start: ${start.text}`);
      assert.equal(start.json().status.member_id, own);
      const started = db.sessions.filter((s) => !s.ended_at);
      assert.deepEqual(started.map((s) => s.member_id), [own], `${who}: the new fast is their own`);
      // With no ID at all, too.
      assert.equal((await call('POST', '/api/fast/start', headers, {})).json().code, 'fast_in_progress');
      // Ending "someone else's" fast ends the requester's own.
      const end = await call('POST', '/api/fast/end', headers, { member_id: other });
      assert.equal(end.status, 200, `${who} end: ${end.text}`);
      assert.ok(started[0].ended_at, `${who}: their own fast ended`);
      assert.deepEqual([...new Set(db.membersTouched())], [own], `${who}: only their own rows`);

      // Adjusting a fast: theirs, whatever ID the body names; another's is refused, whatever ID the body names.
      const startedAt = new Date(Date.now() - 17 * 3600000).toISOString();
      const ownSession = own === PARENT_ID ? 10 : 20;
      const otherSession = own === PARENT_ID ? 20 : 10;
      for (const memberId of [own, other, undefined]) {
        const refused = await call('PUT', `/api/fast/${otherSession}/times`, headers, { member_id: memberId, started_at: startedAt });
        assert.equal(refused.status, 403, `${who} adjusts another's fast, naming ${memberId}`);
        assert.equal(refused.headers['cache-control'], 'no-store');
      }
      assert.ok(!db.queries.some((q) => q.sql.startsWith('UPDATE fast_sessions') && q.params[0] === otherSession), 'the other fast is untouched');
      const mine = await call('PUT', `/api/fast/${ownSession}/times`, headers, { member_id: other, started_at: startedAt });
      assert.equal(mine.status, 200, `${who} adjusts their own fast: ${mine.text}`);
      assert.deepEqual([...new Set(db.membersTouched())], [own], `${who}: only their own rows`);
    });
  }
});

test('local mode keeps the picker\'s choice: the IDs a request names are used as before', async () => {
  const db = new Db();
  await withServer({}, db, async (call) => {
    assert.equal((await call('GET', `/api/me/${KID_ID}/plan`, {})).status, 200);
    assert.equal((await call('POST', '/api/fast/start', {}, { member_id: KID_ID })).status, 201);
    assert.equal((await call('PUT', '/api/fast/10/times', {}, { member_id: PARENT_ID, started_at: new Date(Date.now() - 17 * 3600000).toISOString() })).status, 200);
    assert.equal((await call('PUT', '/api/fast/20/times', {}, { member_id: PARENT_ID, started_at: new Date(Date.now() - 17 * 3600000).toISOString() })).status, 403);
    assert.equal((await call('POST', '/api/fast/start', {}, {})).status, 400);
    assert.equal((await call('GET', '/login', {})).status, 200);
    assert.deepEqual((await call('GET', '/api/whoami', {})).json(), { mode: 'local', member: null });
  });
});

test('the family board is everyone\'s: members and the leaderboard', async () => {
  await withServer(TAILNET, new Db(), async (call) => {
    for (const headers of [PARENT_HEADERS, KID_HEADERS]) {
      const members = await call('GET', '/api/members', headers);
      assert.equal(members.status, 200);
      assert.deepEqual(members.json().members.map((m) => m.id), [PARENT_ID, KID_ID]);
      const board = await call('GET', '/api/family/leaderboard', headers);
      assert.equal(board.status, 200);
      assert.deepEqual(board.json().leaderboard.map((m) => m.member_id).sort(), [PARENT_ID, KID_ID]);
    }
  });
});

test('who am I: the linked member, with the directory\'s role, and no picker page', async () => {
  const db = new Db();
  // The rows' stored roles say the opposite of the directory for the parent: the directory decides.
  db.rows[0].role = 'kid';
  await withServer(TAILNET, db, async (call) => {
    const parent = await call('GET', '/api/whoami', PARENT_HEADERS);
    assert.equal(parent.headers['cache-control'], 'no-store');
    assert.deepEqual(parent.json(), { mode: 'tailnet', member: { id: PARENT_ID, name: 'Parent', avatar_emoji: '🧑', role: 'parent' } });
    assert.deepEqual((await call('GET', '/api/whoami', KID_HEADERS)).json(), { mode: 'tailnet', member: { id: KID_ID, name: 'Kid', avatar_emoji: '🧒', role: 'kid' } });
    // An unlinked parent or kid gets no answer from it.
    assert.equal((await call('GET', '/api/whoami', NEW_PARENT_HEADERS)).json().code, 'not_linked');
    assert.equal((await call('GET', '/api/whoami', NEW_KID_HEADERS)).json().code, 'not_linked');
    // The picker's page, in any spelling, goes to the app: Home Base says who this is.
    for (const route of ['/login', '/LOGIN', '/login/', '/login.html', '/Login.HTML']) {
      for (const headers of [PARENT_HEADERS, KID_HEADERS]) {
        const res = await call('GET', route, headers);
        assert.equal(res.status, 303, route);
        assert.equal(res.headers.location, '/fte/', route);
      }
    }
  });
});

test('first-run setup in tailnet mode: only an unlinked parent, only while there is no household', async () => {
  const household = { members: [{ name: 'Parent', role: 'parent' }, { name: 'Kid', role: 'kid' }] };
  // No household yet: an unlinked kid can't; an unlinked parent can.
  const empty = new Db([]);
  await withServer(TAILNET, empty, async (call) => {
    const kid = await call('POST', '/api/bootstrap/household', NEW_KID_HEADERS, household);
    assert.equal(kid.status, 403);
    assert.equal(kid.json().code, 'not_linked');
    assert.equal(empty.rows.length, 0);
    const parent = await call('POST', '/api/bootstrap/household', NEW_PARENT_HEADERS, household);
    assert.equal(parent.status, 201, parent.text);
    assert.equal(empty.rows.length, 2);
    // Once there is one, setup refuses, and an unlinked parent learns only that.
    const again = await call('POST', '/api/bootstrap/household', NEW_PARENT_HEADERS, household);
    assert.equal(again.status, 409);
    assert.deepEqual((await call('GET', '/api/bootstrap', NEW_PARENT_HEADERS)).json(), { app: 'fast-to-eat', bootstrap: { needs_household: false } });
  });
  // Linked members, parent or kid, meet a household that exists.
  await withServer(TAILNET, new Db(), async (call) => {
    for (const headers of [PARENT_HEADERS, KID_HEADERS]) {
      const res = await call('POST', '/api/bootstrap/household', headers, household);
      assert.equal(res.status, 409);
      assert.equal(res.json().code, 'household_already_initialized');
    }
  });
});

// The pages, run as the browser would with a stand-in fetch, document and localStorage.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function element() {
  const classes = new Set();
  return {
    textContent: '', value: '', dataset: {}, disabled: false,
    classList: {
      add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c),
      toggle: (c, on = !classes.has(c)) => { if (on) classes.add(c); else classes.delete(c); return on; },
    },
    addEventListener() {},
  };
}
function runPage(file, whoami, stored) {
  const fetched = [];
  const elements = new Map();
  let ready = null;
  const redirects = [];
  const context = vm.createContext({
    document: {
      addEventListener: (event, fn) => { if (event === 'DOMContentLoaded') ready = fn; },
      getElementById: (id) => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
      querySelectorAll: () => [],
    },
    window: { location: { replace: (to) => redirects.push(to) } },
    localStorage: { getItem: (key) => (key === 'fte_member' ? stored : null), setItem() {}, removeItem() {} },
    fetch: async (url) => {
      fetched.push(url);
      if (url === 'api/whoami') return whoami();
      return { ok: false, status: 503, json: async () => ({ error: 'stand-in' }) };
    },
    setInterval: () => 0,
    Intl, Date, Promise, JSON,
  });
  new vm.Script(fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8'), { filename: file }).runInContext(context);
  return { context, fetched, elements, redirects, ready: () => ready() };
}
const answer = (body, ok = true) => async () => ({ ok, json: async () => body });
const PICKED = JSON.stringify({ id: 7, name: 'Picked' });
const LINKED = { id: KID_ID, name: 'Kid', avatar_emoji: '🧒', role: 'kid' };

test('pages take the member from Home Base in tailnet mode, and the picker\'s choice in local mode', async () => {
  for (const file of ['app.js', 'calendar.js', 'progress.js', 'settings.js']) {
    // Tailnet: the linked member, whatever the device's picker last stored.
    assert.deepEqual(await runPage(file, answer({ mode: 'tailnet', member: LINKED }), PICKED).context.loadMember(), LINKED, file);
    // Local, an older server without whoami, or offline: the picker's choice, as before.
    for (const whoami of [answer({ mode: 'local', member: null }), answer({ error: 'Not found' }, false), async () => { throw new Error('offline'); }]) {
      assert.deepEqual(await runPage(file, whoami, PICKED).context.loadMember(), { id: 7, name: 'Picked' }, file);
      assert.equal(await runPage(file, whoami, null).context.loadMember(), null, file);
    }
  }
});

test('the Today page offers no switching in tailnet mode, and keeps it in local mode', async () => {
  const tailnetPage = runPage('app.js', answer({ mode: 'tailnet', member: LINKED }), PICKED);
  await tailnetPage.ready();
  assert.ok(tailnetPage.elements.get('switch-user').classList.contains('hidden'));
  assert.ok(tailnetPage.fetched.includes(`api/me/${KID_ID}/status`), 'reads the linked member\'s own status');
  assert.deepEqual(tailnetPage.redirects, []);

  const localPage = runPage('app.js', answer({ mode: 'local', member: null }), PICKED);
  await localPage.ready();
  assert.ok(!localPage.elements.get('switch-user').classList.contains('hidden'));
  assert.ok(localPage.fetched.includes('api/me/7/status'));
  // Nobody picked yet, in local mode: the picker, as before.
  const unpicked = runPage('app.js', answer({ mode: 'local', member: null }), null);
  await unpicked.ready();
  assert.deepEqual(unpicked.redirects, ['login']);
});
