'use strict';

const { ApiError } = require('./errors');
const { fold } = require('./text');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9(][0-9 ()-]{5,18}[0-9]$/;

const TEXT_FIELDS = { firstName: 100, lastName: 100, email: 254, phone: 20 };
const REQUIRED = ['firstName', 'lastName'];
const ADDRESS_FIELDS = { street: 200, city: 100, country: 100, postalCode: 20 };
const EDITABLE = new Set([...Object.keys(TEXT_FIELDS), 'address', 'tags', 'favorite']);
// Clients often send back what they GET; these are accepted and ignored.
const READ_ONLY = new Set(['id', 'createdAt', 'updatedAt']);

const MAX_TAGS = 10;
const MAX_TAG_LENGTH = 30;
const SORT_FIELDS = ['name', 'firstName', 'lastName', 'email', 'city', 'createdAt', 'updatedAt'];
const MAX_LIMIT = 100;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Trims a string. Returns the string, or null when empty/null, or undefined
 * (after recording an error) when the value is unusable.
 */
function cleanString(value, field, max, errors) {
  if (value === null) return null;
  if (typeof value !== 'string') {
    errors.push({ field, message: 'Must be a string' });
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (trimmed.length > max) {
    errors.push({ field, message: `Must be at most ${max} characters` });
    return undefined;
  }
  return trimmed;
}

function parseAddress(raw, errors) {
  // `address: null` clears every address field (on PATCH it empties an existing address).
  if (raw === null) return Object.fromEntries(Object.keys(ADDRESS_FIELDS).map((key) => [key, null]));
  if (!isPlainObject(raw)) {
    errors.push({ field: 'address', message: 'Must be an object' });
    return undefined;
  }
  const address = {};
  for (const [key, value] of Object.entries(raw)) {
    const field = `address.${key}`;
    if (!(key in ADDRESS_FIELDS)) {
      errors.push({ field, message: 'Unknown field' });
      continue;
    }
    const clean = cleanString(value, field, ADDRESS_FIELDS[key], errors);
    if (clean !== undefined) address[key] = clean;
  }
  return address;
}

/**
 * Trims and de-duplicates tags. "Work", "work" and " WORK " count as one tag;
 * the first spelling is kept. `null` clears all tags.
 */
function parseTags(raw, errors) {
  if (raw === null) return [];
  if (!Array.isArray(raw)) {
    errors.push({ field: 'tags', message: 'Must be an array of strings' });
    return undefined;
  }
  if (raw.length > MAX_TAGS) {
    errors.push({ field: 'tags', message: `Must have at most ${MAX_TAGS} tags` });
    return undefined;
  }
  const tags = [];
  const seen = new Set();
  raw.forEach((value, index) => {
    const field = `tags[${index}]`;
    if (typeof value !== 'string') {
      errors.push({ field, message: 'Must be a string' });
      return;
    }
    const tag = value.trim();
    if (tag === '') {
      errors.push({ field, message: 'Must not be empty' });
    } else if (tag.length > MAX_TAG_LENGTH) {
      errors.push({ field, message: `Must be at most ${MAX_TAG_LENGTH} characters` });
    } else if (!seen.has(fold(tag))) {
      seen.add(fold(tag));
      tags.push(tag);
    }
  });
  return tags;
}

/**
 * Validates a contact body.
 *  - partial=false (POST, PUT): firstName and lastName required, missing optionals get defaults.
 *  - partial=true  (PATCH): only the supplied fields are returned.
 * Returns the cleaned value; throws a 400 ApiError listing every problem found.
 */
function parseContact(body, { partial }) {
  if (!isPlainObject(body)) {
    throw ApiError.badRequest('Request body must be a JSON object (send Content-Type: application/json)');
  }

  const errors = [];
  const input = {};
  for (const [key, value] of Object.entries(body)) {
    if (READ_ONLY.has(key)) continue;
    if (!EDITABLE.has(key)) {
      errors.push({ field: key, message: 'Unknown field' });
      continue;
    }
    input[key] = value;
  }

  const out = {};
  for (const [field, max] of Object.entries(TEXT_FIELDS)) {
    if (!(field in input)) continue;
    const clean = cleanString(input[field], field, max, errors);
    if (clean !== undefined) out[field] = clean;
  }

  if (out.email && !EMAIL_RE.test(out.email)) {
    errors.push({ field: 'email', message: 'Must be a valid email address' });
  }
  if (out.phone && !PHONE_RE.test(out.phone)) {
    errors.push({ field: 'phone', message: 'Must be a phone number such as +90 555 010 1234' });
  }

  if ('address' in input) {
    const address = parseAddress(input.address, errors);
    if (address !== undefined) out.address = address;
  }

  if ('tags' in input) {
    const tags = parseTags(input.tags, errors);
    if (tags !== undefined) out.tags = tags;
  }

  if ('favorite' in input) {
    if (typeof input.favorite === 'boolean') out.favorite = input.favorite;
    else errors.push({ field: 'favorite', message: 'Must be true or false' });
  }

  for (const field of REQUIRED) {
    if (!partial && !out[field] && !errors.some((e) => e.field === field)) {
      errors.push({ field, message: 'Required' });
    }
    if (partial && field in input && out[field] === null) {
      errors.push({ field, message: 'Cannot be empty' });
    }
  }
  if (partial && errors.length === 0 && Object.keys(out).length === 0) {
    errors.push({ field: 'body', message: 'At least one editable field is required' });
  }

  if (errors.length > 0) throw ApiError.badRequest('Validation failed', errors);
  return out;
}

function parseId(raw) {
  if (!/^[1-9]\d{0,14}$/.test(raw)) {
    throw ApiError.badRequest('Validation failed', [
      { field: 'id', message: 'Must be a positive integer' },
    ]);
  }
  return Number(raw);
}

/** Validates the query string of GET /contacts. */
function parseListQuery(query) {
  const errors = [];
  const single = (name) => {
    const value = query[name];
    if (value === undefined) return undefined;
    if (typeof value !== 'string') {
      errors.push({ field: name, message: 'Must be given only once' });
      return undefined;
    }
    return value;
  };
  const integer = (name, fallback, min, max) => {
    const value = single(name);
    if (value === undefined) return fallback;
    const n = Number(value);
    if (!/^\d+$/.test(value) || n < min || n > max) {
      errors.push({ field: name, message: `Must be an integer between ${min} and ${max}` });
      return fallback;
    }
    return n;
  };

  const q = single('q');
  const tag = single('tag');
  const favoriteRaw = single('favorite');
  const sortBy = single('sortBy') ?? 'createdAt';
  const order = single('order') ?? 'asc';

  let favorite;
  if (favoriteRaw !== undefined) {
    if (favoriteRaw === 'true') favorite = true;
    else if (favoriteRaw === 'false') favorite = false;
    else errors.push({ field: 'favorite', message: 'Must be true or false' });
  }
  if (!SORT_FIELDS.includes(sortBy)) {
    errors.push({ field: 'sortBy', message: `Must be one of: ${SORT_FIELDS.join(', ')}` });
  }
  if (order !== 'asc' && order !== 'desc') {
    errors.push({ field: 'order', message: 'Must be asc or desc' });
  }
  const page = integer('page', 1, 1, 1_000_000);
  const limit = integer('limit', 20, 1, MAX_LIMIT);

  if (errors.length > 0) throw ApiError.badRequest('Invalid query parameters', errors);
  return { q: q?.trim() || undefined, tag: tag?.trim() || undefined, favorite, sortBy, order, page, limit };
}

module.exports = { parseContact, parseId, parseListQuery, SORT_FIELDS, MAX_LIMIT, MAX_TAGS, MAX_TAG_LENGTH };
