import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../dist/locations.js', import.meta.url), 'utf8');
const BRANCHES = [
  { id: 'santa-lucia', city: 'medellin', name: 'Santa Lucía', address: 'Cr. 87 # 47 DD 50', lat: 6.258786, lng: -75.6038704, open: true },
  { id: 'niquia', city: 'bello', name: 'Niquía', address: 'Dg. 55 AV 33, Bello, Antioquia, Colombia', lat: 6.3409011, lng: -75.5410679, open: false, approximate: true }
];

class Element {
  constructor({ id = '', dataset = {}, text = '', hidden = false } = {}) {
    this.id = id; this.dataset = dataset; this.textContent = text; this.hidden = hidden; this.disabled = false;
    this.attributes = new Map(); this.listeners = new Map(); this.classes = new Set(); this.children = [];
    this.classList = { toggle: (name, force) => { const enabled = force ?? !this.classes.has(name); if (enabled) this.classes.add(name); else this.classes.delete(name); return enabled; }, contains: name => this.classes.has(name) };
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(name, listener) { const list = this.listeners.get(name) || []; this.listeners.set(name, [...list, listener]); }
  removeEventListener(name, listener) { this.listeners.set(name, (this.listeners.get(name) || []).filter(item => item !== listener)); }
  querySelector(selector) { return selector === '[data-location-label]' ? this.children[0] || null : null; }
  click() { if (this.disabled) return; for (const listener of this.listeners.get('click') || []) listener({ currentTarget: this, target: this }); }
}

function fixture(branches = BRANCHES) {
  const label = new Element({ text: 'Usar mi ubicación' });
  const button = new Element({ id: 'location-button' }); button.children.push(label);
  const result = new Element({ id: 'city-result', text: 'En Medellín, te esperamos en Santa Lucía.' });
  const hint = new Element({ id: 'location-hint', text: 'Puedes elegir tu ciudad.' });
  const cities = ['medellin', 'bello'].map(city => { const element = new Element({ dataset: { city } }); element.setAttribute('aria-pressed', String(city === 'medellin')); return element; });
  const distances = branches.map(branch => new Element({ dataset: { distanceFor: branch.id }, hidden: true }));
  const badges = branches.map(branch => new Element({ dataset: { nearestFor: branch.id }, hidden: true }));
  const cards = branches.map(branch => { const element = new Element({ id: `sede-${branch.id}` }); element.classList.toggle('active-location', branch.city === 'medellin'); return element; });
  const elements = [button, result, hint, ...cities, ...distances, ...badges, ...cards];
  const document = {
    getElementById(id) { return elements.find(element => element.id === id) || null; },
    querySelectorAll(selector) { return ({ '[data-city]': cities, '[data-distance-for]': distances, '[data-nearest-for]': badges })[selector] || []; }
  };
  const requests = [];
  const geolocation = { getCurrentPosition(success, failure, options) { requests.push({ success, failure, options }); } };
  const context = vm.createContext({
    document, navigator: { geolocation }, isSecureContext: true, ImportadosBranches: branches,
    fetch() { assert.fail('Location calculations must never request a provider'); },
    localStorage: { setItem() { assert.fail('Location must not be persisted'); } },
    sessionStorage: { setItem() { assert.fail('Location must not be persisted'); } }
  });
  vm.runInContext(source, context);
  return { api: context.ImportadosLocations, document, geolocation, requests, button, label, result, hint, cities, distances, badges, cards };
}
const position = (branch, accuracy = 30) => ({ coords: { latitude: branch.lat, longitude: branch.lng, accuracy } });

test('great-circle distances are symmetric, zero at the same pin, and reject invalid coordinates', () => {
  const { api } = fixture();
  assert.equal(api.distanceMeters(0, 0, 0, 0), 0);
  const distance = api.distanceMeters(0, 0, 0, 1);
  assert.ok(distance > 111000 && distance < 111300);
  assert.equal(distance, api.distanceMeters(0, 1, 0, 0));
  assert.ok(Number.isNaN(api.distanceMeters(91, 0, 0, 0)));
  assert.ok(Number.isNaN(api.distanceMeters(0, 181, 0, 0)));
  assert.ok(Number.isNaN(api.distanceMeters(null, 0, 0, 0)));
  assert.ok(Number.isNaN(api.distanceMeters(NaN, 0, 0, 0)));
  assert.ok(Number.isFinite(api.distanceMeters(0, 0, 0, 180)));
});

test('ranking accepts zero coordinates, excludes unknown pins, and never mutates branch data', () => {
  const { api } = fixture();
  const branches = [{ id: 'far', lat: 0, lng: 1 }, { id: 'here', lat: 0, lng: 0 }, { id: 'unknown', lat: null, lng: null }];
  const ranked = api.rankBranches({ coords: { latitude: 0, longitude: 0 } }, branches);
  assert.equal(ranked.length, 2); assert.equal(ranked[0].id, 'here'); assert.equal(ranked[0].distanceMeters, 0);
  assert.equal(Object.hasOwn(branches[0], 'distanceMeters'), false);
  assert.equal(api.rankBranches({ latitude: -91, longitude: 0 }, branches).length, 0);
});

test('distance labels avoid false precision for very close points and round metres and kilometres', () => {
  const { api } = fixture();
  assert.match(api.formatDistance(0), /menos de 100 m/);
  assert.match(api.formatDistance(99.9), /menos de 100 m/);
  assert.equal(api.formatDistance(249), '200 m');
  assert.equal(api.formatDistance(251), '300 m');
  assert.equal(api.formatDistance(1249), '1,2 km');
  assert.equal(api.formatDistance(-1), 'No disponible');
});

test('Maps uses a valid destination pin or encoded address, without the visitor origin or an API key', () => {
  const { api } = fixture();
  const pin = new URL(api.directionsUrl(BRANCHES[0]));
  assert.equal(pin.origin, 'https://www.google.com');
  assert.equal(pin.searchParams.get('api'), '1');
  assert.equal(pin.searchParams.get('destination'), '6.258786,-75.6038704');
  assert.equal(pin.searchParams.has('origin'), false); assert.equal(pin.searchParams.has('key'), false);
  const address = new URL(api.directionsUrl({ ...BRANCHES[1], lat: null, lng: null }));
  assert.equal(address.searchParams.get('destination'), 'Dg. 55 AV 33, Bello, Antioquia, Colombia');
  assert.equal(address.hash, '');
  const shortAddress = new URL(api.directionsUrl({ ...BRANCHES[1], address: 'Dg. 55 AV 33', lat: null, lng: null }));
  assert.equal(shortAddress.searchParams.get('destination'), address.searchParams.get('destination'));
  assert.equal(api.directionsUrl({ lat: null, lng: null }), '');
});

test('initialization never requests location; an explicit click shows distances and the nearby open branch', () => {
  const view = fixture(); view.api.initFinder();
  assert.equal(view.requests.length, 0);
  view.button.click(); assert.equal(view.requests.length, 1); assert.equal(view.button.disabled, true); assert.equal(view.label.textContent, 'Calculando…'); assert.equal(view.result.dataset.state, 'loading');
  view.requests[0].success(position(BRANCHES[0]));
  assert.equal(view.button.disabled, false); assert.equal(view.label.textContent, 'Usar mi ubicación');
  assert.ok(view.distances.every(element => !element.hidden && /en línea recta/.test(element.textContent)));
  assert.equal(view.badges[0].hidden, false); assert.equal(view.badges[1].hidden, true);
  assert.match(view.result.textContent, /Santa Lucía/); assert.match(view.result.textContent, /Ya puedes visitarnos/);
  assert.equal(view.result.dataset.state, 'success');
  assert.match(view.hint.textContent, /sin enviarla ni guardarla/);
});

test('a nearby upcoming branch remains labelled unopened and suggests the available Santa Lucia branch', () => {
  const view = fixture(); view.api.initFinder(); view.button.click(); view.requests[0].success(position(BRANCHES[1]));
  assert.equal(view.badges[1].hidden, false); assert.equal(view.cards[1].classList.contains('active-location'), true);
  assert.equal(view.cities[1].getAttribute('aria-pressed'), 'true');
  assert.match(view.result.textContent, /Niquía/); assert.match(view.result.textContent, /Apertura muy pronto/);
  assert.match(view.result.textContent, /Santa Lucía, disponible a .+ en línea recta/);
  assert.match(view.result.textContent, /La referencia más cercana/);
  assert.match(view.result.textContent, /entrada exacta de Niquía está por confirmar/);
});

test('denied, unavailable, timed-out and invalid locations reset busy state and allow retry', () => {
  for (const code of [1, 2, 3]) {
    const view = fixture(); view.api.initFinder(); view.button.click(); view.requests[0].failure({ code });
    assert.equal(view.button.disabled, false); assert.equal(view.label.textContent, 'Usar mi ubicación');
    assert.ok(view.distances.every(element => element.hidden)); assert.ok(view.badges.every(element => element.hidden));
    assert.match(view.result.textContent, /permiso|obtener|tardó/);
    assert.equal(view.result.dataset.state, 'error');
    view.button.click(); assert.equal(view.requests.length, 2);
  }
  const invalid = fixture(); invalid.api.initFinder(); invalid.button.click(); invalid.requests[0].success({ coords: { latitude: Infinity, longitude: 0 } });
  assert.equal(invalid.button.disabled, false); assert.match(invalid.result.textContent, /no es válida/);
});

test('manual selection invalidates a pending location response and clears an earlier distance result', () => {
  const view = fixture(); view.api.initFinder(); view.button.click();
  view.cities[1].click(); const manualResult = view.result.textContent;
  assert.equal(view.button.disabled, false); assert.equal(view.cities[1].getAttribute('aria-pressed'), 'true');
  assert.equal(view.result.dataset.state, undefined);
  view.requests[0].success(position(BRANCHES[0])); assert.equal(view.result.textContent, manualResult);
  assert.ok(view.distances.every(element => element.hidden)); assert.ok(view.badges.every(element => element.hidden));
  view.button.click(); view.requests[1].success(position(BRANCHES[1]));
  view.cities[0].click(); assert.ok(view.distances.every(element => element.hidden)); assert.ok(view.badges.every(element => element.hidden));
  assert.equal(view.hint.textContent, 'Puedes elegir tu ciudad.');
});

test('an older request cannot overwrite a newer request after manual selection', () => {
  const view = fixture(); view.api.initFinder(); view.button.click(); view.cities[1].click(); view.button.click();
  view.requests[0].failure({ code: 1 }); assert.equal(view.button.disabled, true);
  view.requests[1].success(position(BRANCHES[1])); assert.match(view.result.textContent, /Niquía/);
});

test('low-precision GPS reports its limitation without displaying distances or a nearest badge', () => {
  const view = fixture(); view.api.initFinder(); view.button.click(); view.requests[0].success(position(BRANCHES[0], 1500));
  assert.equal(view.button.disabled, false); assert.match(view.result.textContent, /precisión limitada/);
  assert.match(view.hint.textContent, /superior a 1 km/);
  assert.ok(view.distances.every(element => element.hidden)); assert.ok(view.badges.every(element => element.hidden));
});

test('an unconfirmed branch pin leaves comparison pending and shows only verified distances', () => {
  const branches = [BRANCHES[0], { ...BRANCHES[1], lat: null, lng: null }];
  const view = fixture(branches); view.api.initFinder(); view.button.click(); view.requests[0].success(position(BRANCHES[0]));
  assert.equal(view.distances[0].hidden, false); assert.equal(view.distances[1].hidden, true);
  assert.ok(view.badges.every(element => element.hidden));
  assert.match(view.result.textContent, /ubicación de Niquía está por confirmar/);
  assert.match(view.result.textContent, /comparación de sedes está pendiente/);
  assert.doesNotMatch(view.result.textContent, /más cercana/);
});

test('unsupported and insecure contexts explain the fallback without requesting location', () => {
  const unsupported = fixture(); unsupported.api.initFinder({ geolocation: null }); unsupported.button.click();
  assert.equal(unsupported.requests.length, 0); assert.equal(unsupported.button.disabled, false); assert.match(unsupported.result.textContent, /navegador no permite/);
  const insecure = fixture(); insecure.api.initFinder({ isSecureContext: false }); insecure.button.click();
  assert.equal(insecure.requests.length, 0); assert.equal(insecure.button.disabled, false); assert.match(insecure.result.textContent, /HTTPS/);
});

test('destroying the finder invalidates pending callbacks and removes request listeners', () => {
  const view = fixture(); const finder = view.api.initFinder(); view.button.click(); finder.destroy();
  const before = view.result.textContent; view.requests[0].success(position(BRANCHES[1])); assert.equal(view.result.textContent, before);
  view.button.click(); assert.equal(view.requests.length, 1); assert.equal(view.button.disabled, false);
});
