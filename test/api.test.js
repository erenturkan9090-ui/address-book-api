'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createApp } = require('../src/app');

/** Starts the app on a random port with its own empty store. */
async function start(options = {}) {
  const server = createApp(options).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const call = async (method, path, body, init = {}) => {
    const res = await fetch(base + path, {
      method,
      redirect: 'manual',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      ...init,
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { status: res.status, headers: res.headers, json, text };
  };

  return { call, close: () => new Promise((resolve) => server.close(resolve)) };
}

async function withApp(t, options) {
  const app = await start(options);
  t.after(app.close);
  return app.call;
}

const names = (res) => res.json.data.map((c) => c.firstName);

test('POST /contacts creates a contact with defaults and a Location header', async (t) => {
  const call = await withApp(t);
  const res = await call('POST', '/contacts', { firstName: '  Ece  ', email: 'ece@example.com' });

  assert.equal(res.status, 201);
  assert.equal(res.headers.get('location'), '/contacts/1');
  assert.equal(res.json.id, 1);
  assert.equal(res.json.firstName, 'Ece');
  assert.equal(res.json.lastName, null);
  assert.equal(res.json.favorite, false);
  assert.deepEqual(res.json.address, { street: null, city: null, country: null, postalCode: null });
  assert.equal(res.json.createdAt, res.json.updatedAt);
});

test('POST /contacts reports every validation problem at once', async (t) => {
  const call = await withApp(t);
  const res = await call('POST', '/contacts', {
    email: 'not-an-email',
    phone: 'abc',
    nickname: 'x',
    address: { zip: '1' },
    favorite: 'yes',
  });

  assert.equal(res.status, 400);
  assert.equal(res.json.error.code, 'VALIDATION_ERROR');
  const fields = res.json.error.details.map((d) => d.field).sort();
  assert.deepEqual(fields, ['address.zip', 'email', 'favorite', 'firstName', 'nickname', 'phone']);
});

test('POST /contacts rejects a body that is not a JSON object, and malformed JSON', async (t) => {
  const call = await withApp(t);

  const noBody = await call('POST', '/contacts');
  assert.equal(noBody.status, 400);
  assert.equal(noBody.json.error.code, 'VALIDATION_ERROR');

  const broken = await call('POST', '/contacts', '{"firstName": ');
  assert.equal(broken.status, 400);
  assert.equal(broken.json.error.code, 'MALFORMED_JSON');
});

test('GET /contacts/:id returns 404 for unknown ids and 400 for bad ids', async (t) => {
  const call = await withApp(t);
  const created = await call('POST', '/contacts', { firstName: 'Ece' });

  assert.equal((await call('GET', `/contacts/${created.json.id}`)).status, 200);
  assert.equal((await call('GET', '/contacts/999')).status, 404);
  assert.equal((await call('GET', '/contacts/abc')).status, 400);
  assert.equal((await call('GET', '/contacts/0')).status, 400);
});

test('PUT replaces every field; omitted ones go back to defaults', async (t) => {
  const call = await withApp(t);
  await call('POST', '/contacts', {
    firstName: 'Ece', lastName: 'Kaya', email: 'ece@example.com', favorite: true, address: { city: 'Bursa' },
  });

  const res = await call('PUT', '/contacts/1', { firstName: 'Elif' });
  assert.equal(res.status, 200);
  assert.equal(res.json.firstName, 'Elif');
  assert.equal(res.json.lastName, null);
  assert.equal(res.json.email, null);
  assert.equal(res.json.favorite, false);
  assert.equal(res.json.address.city, null);

  assert.equal((await call('PUT', '/contacts/1', { lastName: 'Only' })).status, 400);
  assert.equal((await call('PUT', '/contacts/42', { firstName: 'X' })).status, 404);
});

test('PUT ignores read-only fields so a GET result can be sent back', async (t) => {
  const call = await withApp(t);
  const created = await call('POST', '/contacts', { firstName: 'Ece' });
  const res = await call('PUT', '/contacts/1', { ...created.json, firstName: 'Elif', id: 77 });

  assert.equal(res.status, 200);
  assert.equal(res.json.id, 1);
  assert.equal(res.json.createdAt, created.json.createdAt);
});

test('PATCH changes only the fields sent and merges the address', async (t) => {
  const call = await withApp(t);
  await call('POST', '/contacts', {
    firstName: 'Ece', lastName: 'Kaya', phone: '+90 555 010 2000', address: { street: 'Cad. 7', city: 'Bursa' },
  });

  const res = await call('PATCH', '/contacts/1', { phone: '+90 555 010 9999', address: { city: 'İzmir' } });
  assert.equal(res.status, 200);
  assert.equal(res.json.phone, '+90 555 010 9999');
  assert.equal(res.json.lastName, 'Kaya');
  assert.deepEqual(res.json.address, { street: 'Cad. 7', city: 'İzmir', country: null, postalCode: null });

  const cleared = await call('PATCH', '/contacts/1', { lastName: null, address: null });
  assert.equal(cleared.json.lastName, null);
  assert.deepEqual(cleared.json.address, { street: null, city: null, country: null, postalCode: null });
});

test('PATCH rejects an empty body, an emptied firstName and unknown ids', async (t) => {
  const call = await withApp(t);
  await call('POST', '/contacts', { firstName: 'Ece' });

  assert.equal((await call('PATCH', '/contacts/1', {})).status, 400);
  assert.equal((await call('PATCH', '/contacts/1', { firstName: '  ' })).status, 400);
  assert.equal((await call('PATCH', '/contacts/1', { email: 'bad' })).status, 400);
  assert.equal((await call('PATCH', '/contacts/9', { phone: '+90 555 010 1234' })).status, 404);
});

test('PATCH moves updatedAt forward but never createdAt', async (t) => {
  const call = await withApp(t);
  const created = await call('POST', '/contacts', { firstName: 'Ece' });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const res = await call('PATCH', '/contacts/1', { lastName: 'Kaya' });

  assert.equal(res.json.createdAt, created.json.createdAt);
  assert.ok(res.json.updatedAt > created.json.updatedAt);
});

test('DELETE removes the contact; a second DELETE is 404', async (t) => {
  const call = await withApp(t);
  await call('POST', '/contacts', { firstName: 'Ece' });

  const first = await call('DELETE', '/contacts/1');
  assert.equal(first.status, 204);
  assert.equal(first.text, '');
  assert.equal((await call('GET', '/contacts/1')).status, 404);
  assert.equal((await call('DELETE', '/contacts/1')).status, 404);
});

test('favorite endpoints are idempotent and feed the favorite filter', async (t) => {
  const call = await withApp(t);
  await call('POST', '/contacts', { firstName: 'Ece' });
  await call('POST', '/contacts', { firstName: 'Elif' });

  const first = await call('PUT', '/contacts/1/favorite');
  const again = await call('PUT', '/contacts/1/favorite');
  assert.equal(first.json.favorite, true);
  assert.equal(again.status, 200);
  assert.equal(again.json.updatedAt, first.json.updatedAt);

  assert.deepEqual(names(await call('GET', '/contacts?favorite=true')), ['Ece']);
  assert.deepEqual(names(await call('GET', '/contacts?favorite=false')), ['Elif']);

  const removed = await call('DELETE', '/contacts/1/favorite');
  assert.equal(removed.json.favorite, false);
  assert.equal((await call('DELETE', '/contacts/1/favorite')).status, 200);
  assert.equal((await call('GET', '/contacts?favorite=true')).json.meta.total, 0);

  assert.equal((await call('PUT', '/contacts/9/favorite')).status, 404);
  assert.equal((await call('GET', '/contacts?favorite=maybe')).status, 400);
});

test('search ignores case and Turkish accents and spans several fields', async (t) => {
  const call = await withApp(t, { seed: true });

  assert.deepEqual(names(await call('GET', '/contacts?q=isik')), ['Işık']);
  assert.deepEqual(names(await call('GET', '/contacts?q=AYSE')), ['Ayşe']);
  assert.deepEqual(names(await call('GET', '/contacts?q=celik')), ['Mehmet']);
  assert.deepEqual(names(await call('GET', '/contacts?q=' + encodeURIComponent('ayşe yılmaz'))), ['Ayşe']);
  assert.deepEqual(names(await call('GET', '/contacts?q=lyon')), ['Marie']);
  assert.deepEqual(names(await call('GET', '/contacts?q=example.com&limit=2')).length, 2);
  assert.equal((await call('GET', '/contacts?q=nobody-has-this')).json.meta.total, 0);
});

test('search combines with the favorite filter', async (t) => {
  const call = await withApp(t, { seed: true });
  assert.deepEqual(names(await call('GET', '/contacts?q=turkiye&favorite=true')), ['Ayşe', 'Işık']);
  assert.deepEqual(names(await call('GET', '/contacts?q=turkiye&favorite=false')), ['Mehmet']);
});

test('sort orders by the chosen field in both directions, Turkish-aware', async (t) => {
  const call = await withApp(t, { seed: true });

  assert.deepEqual(names(await call('GET', '/contacts?sortBy=firstName')), [
    'Ayşe', 'Işık', 'John', 'Marie', 'Mehmet', 'Zeynep',
  ]);
  assert.deepEqual(names(await call('GET', '/contacts?sortBy=firstName&order=desc')), [
    'Zeynep', 'Mehmet', 'Marie', 'John', 'Işık', 'Ayşe',
  ]);
  // Çelik sorts with the C's, ahead of Demir - not after Z as a raw code-point sort would put it.
  assert.deepEqual(names(await call('GET', '/contacts?sortBy=lastName')).slice(0, 3), ['Mehmet', 'Işık', 'Marie']);
});

test('sort puts contacts with a missing value last in either direction', async (t) => {
  const call = await withApp(t, { seed: true });

  // Zeynep has no last name.
  assert.deepEqual(names(await call('GET', '/contacts?sortBy=lastName&order=asc')), [
    'Mehmet', 'Işık', 'Marie', 'John', 'Ayşe', 'Zeynep',
  ]);
  assert.deepEqual(names(await call('GET', '/contacts?sortBy=lastName&order=desc')), [
    'Ayşe', 'John', 'Marie', 'Işık', 'Mehmet', 'Zeynep',
  ]);
});

test('sort defaults to creation order and rejects unknown fields', async (t) => {
  const call = await withApp(t, { seed: true });

  assert.equal(names(await call('GET', '/contacts'))[0], 'Ayşe');
  assert.equal(names(await call('GET', '/contacts?order=desc'))[0], 'Zeynep');

  const bad = await call('GET', '/contacts?sortBy=password&order=sideways');
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.json.error.details.map((d) => d.field).sort(), ['order', 'sortBy']);
});

test('pagination reports totals and validates its parameters', async (t) => {
  const call = await withApp(t, { seed: true });

  const page2 = await call('GET', '/contacts?limit=4&page=2');
  assert.equal(page2.json.data.length, 2);
  assert.deepEqual(page2.json.meta, { total: 6, page: 2, limit: 4, totalPages: 2 });

  const beyond = await call('GET', '/contacts?limit=4&page=9');
  assert.deepEqual(beyond.json.data, []);

  assert.equal((await call('GET', '/contacts?limit=0')).status, 400);
  assert.equal((await call('GET', '/contacts?limit=101')).status, 400);
  assert.equal((await call('GET', '/contacts?page=-1')).status, 400);
  assert.equal((await call('GET', '/contacts?page=1&page=2')).status, 400);
});

test('an empty address book lists nothing and seed=false starts empty', async (t) => {
  const call = await withApp(t);
  const res = await call('GET', '/contacts');
  assert.deepEqual(res.json, { data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } });
});

test('seeded app starts with sample contacts', async (t) => {
  const call = await withApp(t, { seed: true });
  assert.equal((await call('GET', '/contacts')).json.meta.total, 6);
  assert.equal((await call('GET', '/health')).json.contacts, 6);
});

test('two apps do not share data', async (t) => {
  const a = await withApp(t);
  const b = await withApp(t);
  await a('POST', '/contacts', { firstName: 'Ece' });
  assert.equal((await b('GET', '/contacts')).json.meta.total, 0);
});

test('unknown routes answer with the JSON error format', async (t) => {
  const call = await withApp(t);
  const res = await call('GET', '/nope');
  assert.equal(res.status, 404);
  assert.equal(res.json.error.code, 'NOT_FOUND');
  assert.equal(res.headers.get('x-powered-by'), null);
});

test('swagger page and OpenAPI document are served', async (t) => {
  const call = await withApp(t);

  const root = await call('GET', '/');
  assert.equal(root.status, 302);
  assert.equal(root.headers.get('location'), '/api-docs');

  const page = await call('GET', '/api-docs/');
  assert.equal(page.status, 200);
  assert.match(page.text, /swagger-ui/i);

  const spec = await call('GET', '/openapi.json');
  assert.equal(spec.status, 200);
  assert.equal(spec.json.openapi, '3.0.3');
  assert.deepEqual(Object.keys(spec.json.paths).sort(), [
    '/contacts', '/contacts/{id}', '/contacts/{id}/favorite', '/health',
  ]);
});

test('every route in the OpenAPI document exists in the app', async (t) => {
  const call = await withApp(t, { seed: true });
  const spec = (await call('GET', '/openapi.json')).json;

  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      if (!item[method]) continue;
      const res = await call(method.toUpperCase(), path.replace('{id}', '1'), method === 'get' || method === 'delete' ? undefined : {});
      assert.ok(!(res.status === 404 && res.json?.error?.message?.startsWith('Route')), `${method} ${path} is documented but not routed`);
    }
  }
});
