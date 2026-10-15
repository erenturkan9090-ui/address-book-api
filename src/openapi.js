'use strict';

const { SORT_FIELDS, MAX_LIMIT } = require('./validation');

const idParam = {
  name: 'id',
  in: 'path',
  required: true,
  description: 'Contact id (positive integer).',
  schema: { type: 'integer', minimum: 1, example: 1 },
};

const errorResponse = (description, example) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example } },
});

const notFound = errorResponse('No contact with that id.', {
  error: { status: 404, code: 'NOT_FOUND', message: 'Contact 999 not found' },
});

const badRequest = errorResponse('The id is not a positive integer, or the body failed validation.', {
  error: {
    status: 400,
    code: 'VALIDATION_ERROR',
    message: 'Validation failed',
    details: [{ field: 'email', message: 'Must be a valid email address' }],
  },
});

const contactResponse = (description) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Contact' } } },
});

const jsonBody = (schema, example) => ({
  required: true,
  content: { 'application/json': { schema: { $ref: `#/components/schemas/${schema}` }, example } },
});

const fullExample = {
  firstName: 'Ece',
  lastName: 'Kaya',
  email: 'ece.kaya@example.com',
  phone: '+90 555 010 2000',
  address: { street: 'Cumhuriyet Cad. 7', city: 'Bursa', country: 'Türkiye', postalCode: '16010' },
  favorite: false,
};

module.exports = {
  openapi: '3.0.3',
  info: {
    title: 'Address Book API',
    version: '1.0.0',
    description: [
      'REST API for an address book: create, read, edit, update, delete, search, sort and favorite contacts.',
      '',
      '**Storage is in memory.** Data resets whenever the server restarts, and the service starts with a few sample contacts.',
      '',
      '**Tip:** every endpoint below has a *Try it out* button. Start with `GET /contacts`.',
    ].join('\n'),
  },
  servers: [{ url: '/', description: 'This server' }],
  tags: [
    { name: 'Contacts', description: 'Create, read, edit, update, delete, search and sort contacts.' },
    { name: 'Favorites', description: 'Mark or unmark a contact as a favorite.' },
    { name: 'System', description: 'Health check.' },
  ],
  paths: {
    '/contacts': {
      get: {
        tags: ['Contacts'],
        summary: 'List, search, filter and sort contacts',
        description:
          'Returns one page of contacts. `q` searches first name, last name, email, phone and every address ' +
          'field; it ignores case and Turkish accents (`isik` finds `Işık`) and also matches a full name such as `ayse yilmaz`.',
        parameters: [
          { name: 'q', in: 'query', description: 'Search text.', schema: { type: 'string', example: 'izmir' } },
          {
            name: 'favorite',
            in: 'query',
            description: 'Only favorites (`true`) or only non-favorites (`false`). Leave empty for all.',
            schema: { type: 'boolean' },
          },
          {
            name: 'sortBy',
            in: 'query',
            description: 'Field to sort by. Contacts missing that field always come last.',
            schema: { type: 'string', enum: SORT_FIELDS, default: 'createdAt' },
          },
          {
            name: 'order',
            in: 'query',
            schema: { type: 'string', enum: ['asc', 'desc'], default: 'asc' },
          },
          {
            name: 'page',
            in: 'query',
            schema: { type: 'integer', minimum: 1, default: 1 },
          },
          {
            name: 'limit',
            in: 'query',
            description: `Contacts per page (max ${MAX_LIMIT}).`,
            schema: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, default: 20 },
          },
        ],
        responses: {
          200: {
            description: 'A page of contacts and paging details.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ContactList' } } },
          },
          400: errorResponse('A query parameter is invalid.', {
            error: {
              status: 400,
              code: 'VALIDATION_ERROR',
              message: 'Invalid query parameters',
              details: [{ field: 'sortBy', message: `Must be one of: ${SORT_FIELDS.join(', ')}` }],
            },
          }),
        },
      },
      post: {
        tags: ['Contacts'],
        summary: 'Create a contact',
        description: 'Only `firstName` is required. The new contact is returned with its id; the `Location` header points to it.',
        requestBody: jsonBody('ContactInput', fullExample),
        responses: {
          201: contactResponse('The created contact.'),
          400: badRequest,
        },
      },
    },
    '/contacts/{id}': {
      parameters: [idParam],
      get: {
        tags: ['Contacts'],
        summary: 'Get one contact',
        responses: { 200: contactResponse('The contact.'), 400: badRequest, 404: notFound },
      },
      put: {
        tags: ['Contacts'],
        summary: 'Edit a contact (replace all fields)',
        description:
          'Replaces every editable field. Fields left out are reset to their defaults (empty, `favorite: false`), ' +
          'so send the full contact. To change only some fields use `PATCH`.',
        requestBody: jsonBody('ContactInput', fullExample),
        responses: { 200: contactResponse('The replaced contact.'), 400: badRequest, 404: notFound },
      },
      patch: {
        tags: ['Contacts'],
        summary: 'Update a contact (change only some fields)',
        description:
          'Only the fields you send change. Address fields merge one by one, so `{"address":{"city":"Bursa"}}` ' +
          'leaves the street alone. Send `null` to clear a field (`"address": null` clears the whole address).',
        requestBody: jsonBody('ContactPatch', { phone: '+90 555 010 9999', address: { city: 'Bursa' } }),
        responses: { 200: contactResponse('The updated contact.'), 400: badRequest, 404: notFound },
      },
      delete: {
        tags: ['Contacts'],
        summary: 'Delete a contact',
        responses: { 204: { description: 'Deleted. No content.' }, 400: badRequest, 404: notFound },
      },
    },
    '/contacts/{id}/favorite': {
      parameters: [idParam],
      put: {
        tags: ['Favorites'],
        summary: 'Mark a contact as favorite',
        description: 'Idempotent: marking an existing favorite changes nothing.',
        responses: { 200: contactResponse('The contact, now a favorite.'), 400: badRequest, 404: notFound },
      },
      delete: {
        tags: ['Favorites'],
        summary: 'Remove a contact from favorites',
        description: 'Idempotent. The contact itself is kept; use `DELETE /contacts/{id}` to delete it.',
        responses: { 200: contactResponse('The contact, no longer a favorite.'), 400: badRequest, 404: notFound },
      },
    },
    '/health': {
      get: {
        tags: ['System'],
        summary: 'Health check',
        responses: {
          200: {
            description: 'The service is running.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'ok' },
                    contacts: { type: 'integer', example: 6 },
                    uptimeSeconds: { type: 'integer', example: 120 },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Address: {
        type: 'object',
        properties: {
          street: { type: 'string', nullable: true, maxLength: 200, example: 'Atatürk Cad. 12' },
          city: { type: 'string', nullable: true, maxLength: 100, example: 'İzmir' },
          country: { type: 'string', nullable: true, maxLength: 100, example: 'Türkiye' },
          postalCode: { type: 'string', nullable: true, maxLength: 20, example: '35210' },
        },
      },
      ContactInput: {
        type: 'object',
        required: ['firstName'],
        additionalProperties: false,
        properties: {
          firstName: { type: 'string', minLength: 1, maxLength: 100, example: 'Ece' },
          lastName: { type: 'string', nullable: true, maxLength: 100, example: 'Kaya' },
          email: { type: 'string', format: 'email', nullable: true, maxLength: 254, example: 'ece.kaya@example.com' },
          phone: { type: 'string', nullable: true, maxLength: 20, example: '+90 555 010 2000' },
          address: { $ref: '#/components/schemas/Address' },
          favorite: { type: 'boolean', default: false },
        },
      },
      ContactPatch: {
        type: 'object',
        minProperties: 1,
        additionalProperties: false,
        description: 'Any subset of the contact fields.',
        properties: {
          firstName: { type: 'string', minLength: 1, maxLength: 100 },
          lastName: { type: 'string', nullable: true, maxLength: 100 },
          email: { type: 'string', format: 'email', nullable: true, maxLength: 254 },
          phone: { type: 'string', nullable: true, maxLength: 20 },
          address: { $ref: '#/components/schemas/Address' },
          favorite: { type: 'boolean' },
        },
      },
      Contact: {
        type: 'object',
        properties: {
          id: { type: 'integer', readOnly: true, example: 1 },
          firstName: { type: 'string', example: 'Ayşe' },
          lastName: { type: 'string', nullable: true, example: 'Yılmaz' },
          email: { type: 'string', nullable: true, example: 'ayse.yilmaz@example.com' },
          phone: { type: 'string', nullable: true, example: '+90 555 010 1001' },
          address: { $ref: '#/components/schemas/Address' },
          favorite: { type: 'boolean', example: true },
          createdAt: { type: 'string', format: 'date-time', readOnly: true },
          updatedAt: { type: 'string', format: 'date-time', readOnly: true },
        },
      },
      ContactList: {
        type: 'object',
        properties: {
          data: { type: 'array', items: { $ref: '#/components/schemas/Contact' } },
          meta: {
            type: 'object',
            properties: {
              total: { type: 'integer', description: 'Contacts matching the filters, across all pages.', example: 6 },
              page: { type: 'integer', example: 1 },
              limit: { type: 'integer', example: 20 },
              totalPages: { type: 'integer', example: 1 },
            },
          },
        },
      },
      Error: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              status: { type: 'integer', example: 400 },
              code: { type: 'string', example: 'VALIDATION_ERROR' },
              message: { type: 'string', example: 'Validation failed' },
              details: {
                type: 'array',
                description: 'Present for validation errors: one entry per problem.',
                items: {
                  type: 'object',
                  properties: { field: { type: 'string' }, message: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },
  },
};
