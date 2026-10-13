import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';

const origin = 'https://tiendasimportados.com';
const serviceOrigin = 'https://opeytkcqblgjfyvfjkwe.supabase.co';
const env = {
  SUPABASE_URL: serviceOrigin,
  SUPABASE_SERVICE_KEY: 'test-server-key',
  TURNSTILE_SECRET_KEY: 'test-human-key',
  TURNSTILE_SITE_KEY: 'test-public-widget',
  PUBLIC_LIMITER: { async limit() { return { success: true }; } }
};
const userId = '11fae3bb-fd14-4f14-bf16-155e975cd46d';
const requestId = '41842ca7-c2f7-4b6f-9c22-84c43e4e4f47';
const code = 'f951345c78f74b5eb2a3a22a69b21c8e';
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const post = (path, body, headers = {}) => new Request('https://intranet.tiendasimportados.com' + path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const submission = (extra = {}) => ({ name: 'Persona de prueba', email: 'prueba@example.invalid', subject: 'Consulta de prueba', description: 'Contenido sintético para revisar la recepción.', type: 'peticion', branch_id: 'santa-lucia', request_id: requestId, consultation_code: code, consent: true, token: 'test-token', ...extra });
const humanSuccess = { success: true, action: 'pqrs_submit', hostname: 'tiendasimportados.com' };

async function withFetch(handler, run) {
  const previous = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    calls.push({ url, options });
    return handler(url, options);
  };
  try { return await run(calls); }
  finally { globalThis.fetch = previous; }
}

test('team management rejects an absent token before contacting private services', async () => {
  await withFetch(() => assert.fail('Unauthenticated request reached Supabase'), async () => {
    const result = await worker.fetch(new Request('https://intranet.tiendasimportados.com/api/team'), env);
    assert.equal(result.status, 401);
  });
});

test('a forged bearer cannot gain access by supplying administrator claims', async () => {
  const forged = ['header', 'payload-with-admin-claim', 'unsigned'].join('.');
  await withFetch((url, options) => {
    assert.equal(url.origin, serviceOrigin);
    assert.equal(url.pathname, '/auth/v1/user');
    assert.equal(options.headers.Authorization, 'Bearer ' + forged);
    return response({ error: 'Invalid JWT signature' }, 401);
  }, async calls => {
    const result = await worker.fetch(new Request('https://intranet.tiendasimportados.com/api/team', { headers: { Authorization: 'Bearer ' + forged } }), env);
    assert.equal(result.status, 401);
    assert.equal(calls.length, 1);
  });
});

test('a valid session with administrator metadata still needs an active database administrator profile', async () => {
  for (const profile of [{ id: userId, active: true, role: 'cashier' }, { id: userId, active: false, role: 'admin' }]) {
    await withFetch(url => {
      if (url.pathname === '/auth/v1/user') return response({ id: userId, user_metadata: { role: 'admin' } });
      assert.equal(url.pathname, '/rest/v1/profiles');
      assert.equal(url.searchParams.get('id'), 'eq.' + userId);
      return response([profile]);
    }, async calls => {
      const result = await worker.fetch(new Request('https://intranet.tiendasimportados.com/api/team', { headers: { Authorization: 'Bearer valid.session.signature' } }), env);
      assert.equal(result.status, 403);
      assert.equal(calls.length, 2);
    });
  }
});

test('an active administrator can read the team only after server-side user and role checks', async () => {
  const users = [{ id: userId, full_name: 'Administración de prueba', role: 'admin', active: true }];
  await withFetch(url => {
    if (url.pathname === '/auth/v1/user') return response({ id: userId });
    assert.equal(url.pathname, '/rest/v1/profiles');
    return response(url.searchParams.has('id') ? [{ id: userId, role: 'admin', active: true }] : users);
  }, async calls => {
    const result = await worker.fetch(new Request('https://intranet.tiendasimportados.com/api/team', { headers: { Authorization: 'Bearer valid.session.signature' } }), env);
    assert.equal(result.status, 200);
    assert.deepEqual((await result.json()).users, users);
    assert.equal(calls.length, 3);
    assert.equal(result.headers.get('Cache-Control'), 'no-store');
  });
});

test('cross-origin PQRS submission is refused before verification or database writes', async () => {
  await withFetch(() => assert.fail('Disallowed origin reached a remote service'), async () => {
    const result = await worker.fetch(post('/api/pqrs', submission(), { Origin: 'https://unrelated.example' }), env);
    assert.equal(result.status, 403);
    assert.equal(result.headers.get('Access-Control-Allow-Origin'), null);
  });
});

test('PQRS verification refuses successful tokens issued for a different action or hostname', async () => {
  for (const verdict of [{ ...humanSuccess, action: 'recruitment' }, { ...humanSuccess, hostname: 'unrelated.example' }, { ...humanSuccess, success: false }]) {
    await withFetch(url => {
      assert.equal(url.href, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
      return response(verdict);
    }, async calls => {
      const result = await worker.fetch(post('/api/pqrs', submission()), env);
      assert.equal(result.status, 400);
      assert.equal(calls.length, 1);
    });
  }
});

test('reusing a submission identifier with changed data cannot overwrite or falsely acknowledge a PQRS', async () => {
  await withFetch((url, options) => {
    if (url.hostname === 'challenges.cloudflare.com') return response(humanSuccess);
    assert.equal(url.pathname, '/rest/v1/pqrs_cases');
    if (options.method === 'POST') return response({ code: '23505' }, 409);
    assert.equal(url.searchParams.get('request_id'), 'eq.' + requestId);
    return response([{ case_number: 'IMP-PQ-41842CA7C2F7', payload_hash: 'different-original-payload' }]);
  }, async calls => {
    const result = await worker.fetch(post('/api/pqrs', submission({ subject: 'Otro contenido para el mismo intento' })), env);
    assert.equal(result.status, 409);
    assert.equal((await result.json()).ok, false);
    assert.equal(calls.filter(call => call.options.method === 'POST' && call.url.origin === serviceOrigin).length, 1);
    assert.equal(calls.some(call => ['PATCH', 'PUT', 'DELETE'].includes(call.options.method)), false);
  });
});

test('public PQRS lookup requires the hashed consultation secret and reveals only customer-facing fields', async () => {
  const stored = {
    case_number: 'IMP-PQ-41842CA7C2F7', subject: 'Consulta de prueba', status: 'in_review', response_message: 'Respuesta de prueba',
    created_at: '2026-10-12T15:00:00Z', updated_at: '2026-10-12T15:30:00Z',
    customer_name: 'Persona de prueba', customer_email: 'prueba@example.invalid', customer_phone: '0000000',
    description: 'Información aportada por el cliente', internal_notes: 'Contenido reservado del equipo', lookup_hash: 'private-hash', payload_hash: 'private-hash'
  };
  await withFetch(url => {
    if (url.hostname === 'challenges.cloudflare.com') return response({ ...humanSuccess, action: 'pqrs_lookup' });
    assert.equal(url.pathname, '/rest/v1/pqrs_cases');
    const hash = url.searchParams.get('lookup_hash');
    assert.match(hash, /^eq\.[0-9a-f]{64}$/);
    assert.equal(url.href.includes(code), false);
    const projected = Object.fromEntries(url.searchParams.get('select').split(',').map(key => [key, stored[key]]));
    return response([projected]);
  }, async () => {
    const result = await worker.fetch(post('/api/pqrs/lookup', { case_number: stored.case_number, consultation_code: code, token: 'test-token' }), env);
    assert.equal(result.status, 200);
    const body = await result.json();
    assert.deepEqual(Object.keys(body.case).sort(), ['case_number', 'subject', 'status', 'response_message', 'created_at', 'updated_at'].sort());
    assert.equal(JSON.stringify(body).includes(stored.internal_notes), false);
    assert.equal(JSON.stringify(body).includes(stored.customer_email), false);
    assert.equal(result.headers.get('Access-Control-Allow-Origin'), origin);
    assert.equal(result.headers.get('Cache-Control'), 'no-store');
  });
});

test('an incorrect consultation secret does not disclose whether the radicado exists', async () => {
  await withFetch(url => url.hostname === 'challenges.cloudflare.com' ? response({ ...humanSuccess, action: 'pqrs_lookup' }) : response([]), async () => {
    const result = await worker.fetch(post('/api/pqrs/lookup', { case_number: 'IMP-PQ-41842CA7C2F7', consultation_code: code, token: 'test-token' }), env);
    assert.equal(result.status, 404);
    assert.match((await result.json()).message, /No encontramos una solicitud con esos datos/);
  });
});

test('limiting PQRS requests runs before a human check or storage operation', async () => {
  await withFetch(() => assert.fail('Rate-limited request reached a remote service'), async () => {
    const limited = { ...env, PUBLIC_LIMITER: { async limit() { return { success: false }; } } };
    const result = await worker.fetch(post('/api/pqrs', submission(), { 'CF-Connecting-IP': '192.0.2.5' }), limited);
    assert.equal(result.status, 429);
    assert.equal(result.headers.get('Retry-After'), '60');
  });
});


test('only a verified administrator can provision a scoped first-access link, without sending email',async()=>{
 const invited='5c6e6137-ff5b-44d9-bec7-83ea940b42c9';const link=serviceOrigin+'/auth/v1/verify?token=synthetic-only&type=invite';
 await withFetch((url,options)=>{
  if(url.pathname==='/auth/v1/user')return response({id:userId});
  if(url.pathname==='/rest/v1/profiles'&&options.method!=='POST')return response([{id:userId,role:'admin',active:true}]);
  if(url.pathname==='/auth/v1/admin/generate_link'){const body=JSON.parse(options.body);assert.equal(body.type,'invite');assert.equal(body.email,'new-team@example.invalid');assert.equal(url.searchParams.get('redirect_to'),'https://intranet.tiendasimportados.com/');return response({id:invited,action_link:link});}
  if(url.pathname==='/rest/v1/profiles'){const body=JSON.parse(options.body);assert.equal(body.role,'cashier');assert.equal(body.branch_id,'niquia');assert.equal(body.id,invited);return new Response(null,{status:201});}
  assert.fail('Unexpected provider: '+url.pathname);
 },async calls=>{
  const result=await worker.fetch(post('/api/team',{action:'invite',delivery:'link',email:'new-team@example.invalid',full_name:'Equipo sintético',role:'cashier',branch_id:'niquia'},{Authorization:'Bearer valid.session.signature'}),env);assert.equal(result.status,201);assert.equal((await result.json()).setup_link,link);assert.ok(!calls.some(x=>x.url.pathname==='/auth/v1/invite'));assert.equal(result.headers.get('Cache-Control'),'no-store');
 });
});
