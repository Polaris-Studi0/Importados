import test from 'node:test';
import assert from 'node:assert/strict';
import { observeAuthProfile } from '../src/lib/auth-profile.js';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function until(predicate) {
  for (let step = 0; step < 100; step++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  assert.fail('The observable state did not settle');
}
function authHarness(session = null) {
  let callback;
  let unsubscribed = false;
  const initial = deferred();
  const auth = {
    onAuthStateChange(handler) { callback = handler; return { data: { subscription: { unsubscribe() { unsubscribed = true; } } } }; },
    getSession() { return initial.promise; }
  };
  return {
    auth,
    initial,
    emit(event, id) { return callback(event, id ? { user: { id } } : null); },
    initialize() { initial.resolve({ data: { session }, error: null }); },
    get unsubscribed() { return unsubscribed; }
  };
}

test('auth callbacks return before profile I/O, avoiding a nested Supabase auth lock', async () => {
  const harness = authHarness();
  let calls = 0;
  const states = [];
  const observer = observeAuthProfile({ auth: harness.auth, loadProfile: async () => { calls++; return { active: true }; }, onState: state => states.push(state) });
  try {
    assert.equal(harness.emit('SIGNED_IN', 'a'), undefined);
    assert.equal(calls, 0);
    await until(() => states.at(-1)?.profile?.active);
    assert.equal(calls, 1);
  } finally { observer.stop(); }
});

test('a late initial session cannot restore access after an explicit sign-out event', async () => {
  const harness = authHarness({ user: { id: 'old' } });
  const states = [];
  let calls = 0;
  const observer = observeAuthProfile({ auth: harness.auth, loadProfile: async () => { calls++; return { active: true }; }, onState: state => states.push(state) });
  try {
    harness.emit('SIGNED_OUT', null);
    harness.initialize();
    await tick();
    assert.equal(calls, 0);
    assert.equal(states.at(-1).user, null);
    assert.equal(states.at(-1).profile, null);
  } finally { observer.stop(); }
});

test('a switched user cannot inherit an earlier user profile that finishes later', async () => {
  const harness = authHarness();
  const loads = new Map();
  const states = [];
  const observer = observeAuthProfile({ auth: harness.auth, loadProfile: id => { const pending = deferred(); loads.set(id, pending); return pending.promise; }, onState: state => states.push(state) });
  try {
    harness.emit('SIGNED_IN', 'a');
    await until(() => loads.has('a'));
    harness.emit('SIGNED_IN', 'b');
    assert.equal(states.at(-1).profile, null);
    await until(() => loads.has('b'));
    loads.get('b').resolve({ id: 'b', active: true, role: 'cashier' });
    await until(() => states.at(-1)?.profile?.id === 'b');
    loads.get('a').resolve({ id: 'a', active: true, role: 'admin' });
    await tick();
    assert.equal(states.at(-1).profile.id, 'b');
  } finally { observer.stop(); }
});

test('token renewal keeps an existing workspace mounted during profile revalidation', async () => {
  const harness = authHarness();
  const states = [];
  const renewal = deferred();
  let calls = 0;
  const profile = { id: 'a', active: true, role: 'admin' };
  const observer = observeAuthProfile({ auth: harness.auth, loadProfile: () => ++calls === 1 ? Promise.resolve(profile) : renewal.promise, onState: state => states.push(state) });
  try {
    harness.emit('SIGNED_IN', 'a');
    await until(() => states.at(-1)?.profile === profile);
    const before = states.length;
    harness.emit('TOKEN_REFRESHED', 'a');
    await until(() => calls === 2);
    assert.ok(states.slice(before).every(state => state.profile === profile && state.loading === false));
    renewal.resolve({ ...profile, full_name: 'Updated name' });
    await until(() => states.at(-1)?.profile?.full_name === 'Updated name');
  } finally { observer.stop(); }
});

test('a disabled profile removes retained access on the next revalidation', async () => {
  const harness = authHarness();
  const states = [];
  let calls = 0;
  const observer = observeAuthProfile({ auth: harness.auth, loadProfile: async () => ({ id: 'a', active: ++calls === 1 }), onState: state => states.push(state) });
  try {
    harness.emit('SIGNED_IN', 'a');
    await until(() => states.at(-1)?.profile?.active);
    harness.emit('TOKEN_REFRESHED', 'a');
    await until(() => Boolean(states.at(-1)?.error));
    assert.equal(states.at(-1).profile, null);
    assert.equal(states.at(-1).loading, false);
    assert.match(states.at(-1).error, /no está activo/);
  } finally { observer.stop(); }
});

test('a stalled profile lookup ends loading, aborts I/O, and remains retryable', async () => {
  const harness = authHarness();
  const states = [];
  let signal;
  let retry = false;
  const observer = observeAuthProfile({ auth: harness.auth, timeoutMs: 15, loadProfile: (_id, activeSignal) => { signal = activeSignal; return retry ? Promise.resolve({ id: 'a', active: true }) : new Promise(() => {}); }, onState: state => states.push(state) });
  try {
    harness.emit('SIGNED_IN', 'a');
    await until(() => Boolean(states.at(-1)?.error));
    assert.equal(signal.aborted, true);
    assert.equal(states.at(-1).loading, false);
    assert.equal(states.at(-1).profile, null);
    retry = true;
    observer.retry();
    await until(() => states.at(-1)?.profile?.id === 'a');
  } finally { observer.stop(); }
});

test('stopping observation aborts a pending lookup and ignores every late result', async () => {
  const harness = authHarness();
  const pending = deferred();
  const states = [];
  let signal;
  const observer = observeAuthProfile({ auth: harness.auth, loadProfile: (_id, activeSignal) => { signal = activeSignal; return pending.promise; }, onState: state => states.push(state) });
  harness.emit('SIGNED_IN', 'a');
  await until(() => Boolean(signal));
  observer.stop();
  const before = states.length;
  pending.resolve({ id: 'a', active: true });
  harness.initialize();
  harness.emit('TOKEN_REFRESHED', 'a');
  observer.retry();
  await tick();
  assert.equal(signal.aborted, true);
  assert.equal(harness.unsubscribed, true);
  assert.equal(states.length, before);
});
