'use strict';

const express = require('express');
const swaggerUi = require('swagger-ui-express');

const openapi = require('./openapi');
const { ApiError, errorBody } = require('./errors');
const { ContactStore, seedContacts } = require('./store');
const { parseContact, parseId, parseListQuery } = require('./validation');

/**
 * Builds the Express app. Taking the store as a parameter keeps the app free
 * of globals, so every test gets its own empty address book.
 */
function createApp({ store = new ContactStore(), seed = false, logRequests = false } = {}) {
  if (seed) seedContacts(store);

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  if (logRequests) {
    app.use((req, res, next) => {
      const startedAt = process.hrtime.bigint();
      res.on('finish', () => {
        const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
        console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(1)}ms`);
      });
      next();
    });
  }

  const findOr404 = (rawId) => {
    const id = parseId(rawId);
    const contact = store.get(id);
    if (!contact) throw ApiError.notFound(`Contact ${id} not found`);
    return contact;
  };

  // --- Documentation ------------------------------------------------------
  app.get('/', (req, res) => res.redirect('/api-docs'));
  app.get('/openapi.json', (req, res) => res.json(openapi));
  app.use(
    '/api-docs',
    swaggerUi.serve,
    swaggerUi.setup(openapi, {
      customSiteTitle: 'Address Book API',
      swaggerOptions: { displayRequestDuration: true, tryItOutEnabled: true },
    }),
  );

  // --- System -------------------------------------------------------------
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', contacts: store.size, uptimeSeconds: Math.round(process.uptime()) });
  });

  // --- Contacts -----------------------------------------------------------
  app.get('/contacts', (req, res) => {
    res.json(store.list(parseListQuery(req.query)));
  });

  app.post('/contacts', (req, res) => {
    const contact = store.create(parseContact(req.body, { partial: false }));
    res.status(201).location(`/contacts/${contact.id}`).json(contact);
  });

  app.get('/contacts/:id', (req, res) => {
    res.json(findOr404(req.params.id));
  });

  app.put('/contacts/:id', (req, res) => {
    const { id } = findOr404(req.params.id);
    res.json(store.replace(id, parseContact(req.body, { partial: false })));
  });

  app.patch('/contacts/:id', (req, res) => {
    const { id } = findOr404(req.params.id);
    res.json(store.patch(id, parseContact(req.body, { partial: true })));
  });

  app.delete('/contacts/:id', (req, res) => {
    const { id } = findOr404(req.params.id);
    store.remove(id);
    res.status(204).end();
  });

  // Favorite is a sub-resource: PUT marks it, DELETE unmarks it. Both are
  // idempotent, so repeating a request is harmless.
  app.put('/contacts/:id/favorite', (req, res) => {
    const { id } = findOr404(req.params.id);
    res.json(store.setFavorite(id, true));
  });

  app.delete('/contacts/:id/favorite', (req, res) => {
    const { id } = findOr404(req.params.id);
    res.json(store.setFavorite(id, false));
  });

  // --- Fallbacks ----------------------------------------------------------
  app.use((req, res) => {
    res
      .status(404)
      .json(errorBody(404, 'NOT_FOUND', `Route ${req.method} ${req.path} not found. See /api-docs`));
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof ApiError) {
      return res.status(err.status).json(errorBody(err.status, err.code, err.message, err.details));
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json(errorBody(400, 'MALFORMED_JSON', 'Request body is not valid JSON'));
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json(errorBody(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large'));
    }
    console.error(err);
    return res.status(500).json(errorBody(500, 'INTERNAL_ERROR', 'Something went wrong on our side'));
  });

  return app;
}

module.exports = { createApp };
