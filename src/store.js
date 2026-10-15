'use strict';

const { fold } = require('./text');

const EMPTY_ADDRESS = { street: null, city: null, country: null, postalCode: null };

// Locale-aware, accent/case-insensitive ordering ("Çelik" sorts with the C's).
const collator = new Intl.Collator('tr', { sensitivity: 'base' });

function searchText(contact) {
  const { firstName, lastName, email, phone, address, tags } = contact;
  return [firstName, lastName, email, phone, address.street, address.city, address.country, address.postalCode, ...tags]
    .filter(Boolean)
    .join(' ');
}

const SORT_KEYS = {
  name: (c) => `${c.firstName} ${c.lastName}`,
  firstName: (c) => c.firstName,
  lastName: (c) => c.lastName,
  email: (c) => c.email,
  city: (c) => c.address.city,
  createdAt: (c) => c.createdAt,
  updatedAt: (c) => c.updatedAt,
};
const TIMESTAMP_KEYS = new Set(['createdAt', 'updatedAt']);

function comparator(sortBy, order) {
  const key = SORT_KEYS[sortBy];
  const direction = order === 'desc' ? -1 : 1;
  const compare = TIMESTAMP_KEYS.has(sortBy)
    ? (a, b) => (a < b ? -1 : a > b ? 1 : 0)
    : (a, b) => collator.compare(a, b);

  return (a, b) => {
    const av = key(a);
    const bv = key(b);
    // Equal values fall back to creation order, flipped with the direction so
    // that "desc" is the exact reverse (rows created in the same millisecond tie on createdAt).
    const byId = (a.id - b.id) * direction;
    // Missing values go last whichever way the list is sorted.
    if (av == null || bv == null) {
      if (av == null && bv == null) return byId;
      return av == null ? 1 : -1;
    }
    return compare(av, bv) * direction || byId;
  };
}

/** In-memory contact storage. All data is lost when the process restarts. */
class ContactStore {
  constructor() {
    this.contacts = new Map();
    this.nextId = 1;
  }

  get size() {
    return this.contacts.size;
  }

  create(data) {
    const now = new Date().toISOString();
    const contact = {
      id: this.nextId++,
      firstName: data.firstName,
      lastName: data.lastName ?? null,
      email: data.email ?? null,
      phone: data.phone ?? null,
      address: { ...EMPTY_ADDRESS, ...data.address },
      tags: data.tags ?? [],
      favorite: data.favorite ?? false,
      createdAt: now,
      updatedAt: now,
    };
    this.contacts.set(contact.id, contact);
    return contact;
  }

  get(id) {
    return this.contacts.get(id);
  }

  /** PUT: every editable field is replaced; omitted ones fall back to their defaults. */
  replace(id, data) {
    const current = this.contacts.get(id);
    if (!current) return undefined;
    const next = {
      ...current,
      firstName: data.firstName,
      lastName: data.lastName ?? null,
      email: data.email ?? null,
      phone: data.phone ?? null,
      address: { ...EMPTY_ADDRESS, ...data.address },
      tags: data.tags ?? [],
      favorite: data.favorite ?? false,
      updatedAt: new Date().toISOString(),
    };
    this.contacts.set(id, next);
    return next;
  }

  /** PATCH: only the supplied fields change; address fields merge one by one, tags are replaced as a whole. */
  patch(id, changes) {
    const current = this.contacts.get(id);
    if (!current) return undefined;
    const { address, ...rest } = changes;
    const next = {
      ...current,
      ...rest,
      address: address === undefined ? current.address : { ...current.address, ...address },
      updatedAt: new Date().toISOString(),
    };
    this.contacts.set(id, next);
    return next;
  }

  setFavorite(id, favorite) {
    const current = this.contacts.get(id);
    if (!current) return undefined;
    if (current.favorite === favorite) return current;
    const next = { ...current, favorite, updatedAt: new Date().toISOString() };
    this.contacts.set(id, next);
    return next;
  }

  remove(id) {
    return this.contacts.delete(id);
  }

  /** Every tag in use with how many contacts carry it, for a "filter by tag" dropdown. */
  listTags() {
    const found = new Map();
    for (const contact of this.contacts.values()) {
      for (const tag of contact.tags) {
        const entry = found.get(fold(tag));
        if (entry) entry.count += 1;
        else found.set(fold(tag), { tag, count: 1 });
      }
    }
    return [...found.values()].sort((a, b) => collator.compare(a.tag, b.tag));
  }

  list({ q, tag, favorite, sortBy, order, page, limit }) {
    let rows = [...this.contacts.values()];
    if (favorite !== undefined) rows = rows.filter((c) => c.favorite === favorite);
    if (tag) {
      const wanted = fold(tag);
      rows = rows.filter((c) => c.tags.some((t) => fold(t) === wanted));
    }
    if (q) {
      const needle = fold(q);
      rows = rows.filter((c) => fold(searchText(c)).includes(needle));
    }
    rows.sort(comparator(sortBy, order));

    const total = rows.length;
    const start = (page - 1) * limit;
    return {
      data: rows.slice(start, start + limit),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }
}

/** A few made-up contacts so the Swagger page has something to show on first load. */
function seedContacts(store) {
  const sample = [
    {
      firstName: 'Ayşe', lastName: 'Yılmaz', email: 'ayse.yilmaz@example.com', phone: '+90 555 010 1001',
      address: { street: 'Atatürk Cad. 12', city: 'İzmir', country: 'Türkiye', postalCode: '35210' },
      tags: ['Family', 'Friends'], favorite: true,
    },
    {
      firstName: 'Mehmet', lastName: 'Çelik', email: 'mehmet.celik@example.com', phone: '+90 555 010 1002',
      address: { street: 'Kızılay Sk. 5', city: 'Ankara', country: 'Türkiye', postalCode: '06420' },
      tags: ['Work'],
    },
    {
      firstName: 'Işık', lastName: 'Demir', email: 'isik.demir@example.com', phone: '+90 555 010 1003',
      address: { street: 'Bağdat Cad. 88', city: 'İstanbul', country: 'Türkiye', postalCode: '34728' },
      tags: ['Work', 'Friends'], favorite: true,
    },
    {
      firstName: 'John', lastName: 'Smith', email: 'john.smith@example.com', phone: '+1 555 010 1004',
      address: { street: '221 Main St', city: 'Boston', country: 'USA', postalCode: '02108' },
      tags: ['Work'],
    },
    {
      firstName: 'Marie', lastName: 'Dubois', email: 'marie.dubois@example.com',
      address: { city: 'Lyon', country: 'France' }, tags: ['Family'],
    },
    { firstName: 'Zeynep', lastName: 'Kaya', phone: '+90 555 010 1006', tags: ['Friends'] },
  ];
  sample.forEach((contact) => store.create(contact));
}

module.exports = { ContactStore, seedContacts };
