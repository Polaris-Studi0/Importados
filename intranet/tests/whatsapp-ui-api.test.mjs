import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

// Exercise the actual browser API adapter with only its session provider replaced.
const adapter = await readFile(new URL("../src/lib/whatsapp-api.js", import.meta.url), "utf8");
async function loadApi({ demo = false, session = { access_token: "test-session" } } = {}) {
  const fixtureKey = `wa-test-${crypto.randomUUID()}`;
  globalThis[fixtureKey] = { auth: { getSession: async () => ({ data: { session } }) } };
  const source = adapter.replace('import { isDemoMode, supabase } from "./supabase.js";', `const isDemoMode = ${demo}; const supabase = globalThis[${JSON.stringify(fixtureKey)}];`);
  try { return await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`); }
  finally { delete globalThis[fixtureKey]; }
}

test("WhatsApp uses the current session bearer and passes cancellation to fetch", async t => {
  const api = await loadApi();
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "/api/whatsapp/conversations");
    assert.equal(options.headers.authorization, "Bearer test-session");
    assert.equal(options.signal, controller.signal);
    assert.equal(options.method, "GET");
    return Response.json({ conversations: [], limits: { conversations: 100, truncated: true } });
  });
  assert.deepEqual(await api.listWhatsAppConversations(controller.signal), { conversations: [], limits: { conversations: 100, truncated: true } });
});

test("WhatsApp actions encode IDs and use authoritative version plus a fresh request ID", async t => {
  const api = await loadApi();
  const requestIds = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "/api/whatsapp/conversations/chat%2Fid/actions");
    assert.equal(options.method, "POST");
    const body = JSON.parse(options.body);
    assert.equal(body.expected_control_version, 7);
    assert.equal(body.action, "pause");
    assert.match(body.request_id, /^[0-9a-f]{8}-[0-9a-f-]{27}$/);
    requestIds.push(body.request_id);
    return Response.json({ ok: true, conversation: { id: "chat/id", control_version: 8 } });
  });
  const conversation = { id: "chat/id", control_version: 7 };
  await api.actOnWhatsAppConversation(conversation, { action: "pause", expected_control_version: 1 });
  await api.actOnWhatsAppConversation(conversation, { action: "pause" });
  assert.notEqual(requestIds[0], requestIds[1]);
});

test("Retrying an action with an unknown result preserves the original request ID", async t => {
  const api = await loadApi();
  const requestId = crypto.randomUUID();
  const bodies = [];
  let first = true;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    if (first) { first = false; throw new TypeError("Network response lost"); }
    return Response.json({ ok: true, conversation: { id: "chat", control_version: 8 } });
  });
  const conversation = { id: "chat", control_version: 7 };
  const action = { action: "send", text: "Hola", request_id: requestId };
  await assert.rejects(api.actOnWhatsAppConversation(conversation, action), /Network response lost/);
  await api.actOnWhatsAppConversation(conversation, action);
  assert.equal(bodies[0].request_id, requestId);
  assert.deepEqual(bodies[0], bodies[1]);
});

test("An explicit rejection is distinguishable from an unknown server result", async t => {
  const api = await loadApi();
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json({}, { status: 409 }));
  await assert.rejects(api.getWhatsAppConversation("chat"), error => error.confirmedRejection === true && error.status === 409);
  fetch.mock.mockImplementation(async () => Response.json({}, { status: 500 }));
  await assert.rejects(api.getWhatsAppConversation("chat"), error => error.confirmedRejection === false);
});

test("Demo and expired sessions never call the WhatsApp backend", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("unexpected network request"); });
  const demo = await loadApi({ demo: true });
  const expired = await loadApi({ session: null });
  await assert.rejects(demo.getWhatsAppStatus(), /sesión real/);
  await assert.rejects(expired.listWhatsAppTasks(), /sesión terminó/);
  assert.equal(fetch.mock.callCount(), 0);
});

test("Malformed conversations and detail responses are rejected instead of appearing empty", async t => {
  const api = await loadApi();
  t.mock.method(globalThis, "fetch", async () => Response.json({ conversations: {} }));
  await assert.rejects(api.listWhatsAppConversations(), /No pudimos leer las conversaciones/);
  await assert.rejects(api.getWhatsAppConversation("chat"), /No pudimos leer esta conversación/);
});

test("Conflicts and denied branch access return actionable messages", async t => {
  const api = await loadApi();
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json({}, { status: 409 }));
  await assert.rejects(api.getWhatsAppConversation("chat"), /cambió en otra sesión/);
  fetch.mock.mockImplementation(async () => Response.json({}, { status: 403 }));
  await assert.rejects(api.getWhatsAppConversation("chat"), /otra sede/);
});

test("An unavailable route and an unsuccessful JSON response cannot report success", async t => {
  const api = await loadApi();
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response("<html>unavailable</html>", { status: 404 }));
  await assert.rejects(api.getWhatsAppStatus(), /aún no está disponible/);
  fetch.mock.mockImplementation(async () => Response.json({ ok: false, message: "Operación rechazada." }));
  await assert.rejects(api.getWhatsAppStatus(), /Operación rechazada/);
});

test("A preview sends only the simulation text and chosen branch", async t => {
  const api = await loadApi();
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "/api/whatsapp/preview");
    assert.deepEqual(JSON.parse(options.body), { text: "¿Cuál es el horario?", branch_id: "niquia" });
    return Response.json({ ok: true, preview: { status: "decision_ready", send_allowed: false } });
  });
  const result = await api.previewWhatsApp("¿Cuál es el horario?", "niquia");
  assert.equal(result.preview.send_allowed, false);
});
