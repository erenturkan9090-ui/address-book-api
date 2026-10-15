# Address Book API

SE4458 - Assignment 2: Develop/Deploy a simple REST API. **Group 1 - Address Book.**

A REST API for an address book. You can create, edit, update, delete, search, sort and favorite contacts. Data lives in memory, and the API is documented with a Swagger UI page.

| | |
|---|---|
| **Source code** | https://github.com/erenturkan9090-ui/address-book-api |
| **Live API + Swagger** | https://address-book-api-tmeq.onrender.com/api-docs |
| **Author** | Eren Türkan |

Stack: Node.js 20+, Express 5, `swagger-ui-express`. Tests use the built-in `node:test`, so there is nothing extra to install.

---

## Quick start

```bash
npm install
npm start          # http://localhost:3000  ->  redirects to /api-docs
npm test           # 23 tests
```

Environment variables (both optional): `PORT` (default `3000`) and `SEED=false` to start with an empty address book instead of the sample contacts.

## Endpoints

Every endpoint can be tried from the Swagger page (**Try it out**).

| Method | Path | What it does |
|---|---|---|
| `GET` | `/contacts` | List contacts - **search**, **sort**, favorite filter, paging |
| `POST` | `/contacts` | **Create** a contact (`201` + `Location` header) |
| `GET` | `/contacts/{id}` | Get one contact |
| `PUT` | `/contacts/{id}` | **Edit**: replace all fields |
| `PATCH` | `/contacts/{id}` | **Update**: change only the fields you send |
| `DELETE` | `/contacts/{id}` | **Delete** (`204`) |
| `PUT` | `/contacts/{id}/favorite` | Mark as **favorite** |
| `DELETE` | `/contacts/{id}/favorite` | Remove from favorites |
| `GET` | `/health` | Health check |
| `GET` | `/api-docs` | Swagger UI (`/openapi.json` is the raw spec) |

### `GET /contacts` query parameters

| Parameter | Meaning |
|---|---|
| `q` | Search text. Matches first name, last name, email, phone and every address field. |
| `favorite` | `true` = only favorites, `false` = only non-favorites. |
| `sortBy` | `firstName`, `lastName`, `email`, `city`, `createdAt` (default), `updatedAt` |
| `order` | `asc` (default) or `desc` |
| `page`, `limit` | Paging. Defaults `1` and `20`, max `limit` is `100`. |

Example: `GET /contacts?q=izmir&favorite=true&sortBy=lastName&order=desc&limit=5`

### Contact

```json
{
  "id": 1,
  "firstName": "Ayşe",
  "lastName": "Yılmaz",
  "email": "ayse.yilmaz@example.com",
  "phone": "+90 555 010 1001",
  "address": { "street": "Atatürk Cad. 12", "city": "İzmir", "country": "Türkiye", "postalCode": "35210" },
  "favorite": true,
  "createdAt": "2026-10-15T10:00:00.000Z",
  "updatedAt": "2026-10-15T10:00:00.000Z"
}
```

Only `firstName` is required. Missing optional values are `null`.

### Errors

Every error uses one shape, so a client needs only one parser:

```json
{
  "error": {
    "status": 400,
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [{ "field": "email", "message": "Must be a valid email address" }]
  }
}
```

Codes: `VALIDATION_ERROR` (400), `MALFORMED_JSON` (400), `NOT_FOUND` (404), `PAYLOAD_TOO_LARGE` (413), `INTERNAL_ERROR` (500). Validation reports **all** problems in one response, not just the first.

---

## Design

```
src/
  server.js      starts the HTTP server, handles SIGTERM
  app.js         Express app: routes, error handling, Swagger
  validation.js  turns request bodies/queries into clean values or a 400
  store.js       in-memory storage, search and sort logic
  openapi.js     the OpenAPI 3 document behind the Swagger page
  errors.js      ApiError + the single error response shape
test/api.test.js 23 end-to-end tests against a real HTTP server
```

- **Thin routes, logic elsewhere.** Routes only connect the three pieces: validation, storage, and the response. The storage class knows nothing about HTTP, so replacing the `Map` with a database later touches only `store.js`.
- **`createApp()` takes its store as a parameter.** There are no module-level globals, so each test starts its own empty address book and the tests cannot interfere with each other.
- **PUT vs PATCH.** The assignment lists both "edit" and "update". `PUT` is a full replacement (omitted fields reset to their defaults), `PATCH` changes only what you send. In `PATCH`, address fields merge one by one, and `null` clears a field.
- **Favorite is its own sub-resource.** `PUT`/`DELETE /contacts/{id}/favorite` are idempotent, so retrying never flips the state back (a toggle endpoint would). Listing favorites is the `favorite=true` filter.
- **Search is accent-insensitive and Turkish-aware.** `isik` finds `Işık`, `AYSE` finds `Ayşe`, and `ayse yilmaz` matches across first and last name. Lower-casing uses the `tr` locale because `I`/`İ` are different letters there.
- **Sorting uses `Intl.Collator('tr')`**, so `Çelik` sorts with the C's instead of after `Z` as a plain string comparison would put it. Contacts with a missing value always come last, in both directions. Ties fall back to creation order.
- **Validation is strict about what it accepts, lenient about what it gets back.** Unknown fields are rejected (a typo like `emial` is an error, not silently dropped), but `id`, `createdAt` and `updatedAt` are ignored so a client can send back what it just fetched.
- **Swagger is generated from one OpenAPI document** (`src/openapi.js`) that is also served at `/openapi.json`. A test checks that every documented route actually exists.

## Assumptions

- "Address book" means **contacts that have an address**, not a list of bare addresses. A contact has a name, optional email and phone, and an address made of street, city, country and postal code.
- One shared address book for everyone who uses the API. There is no login or per-user data, as the assignment asks for no authentication.
- In-memory storage means **data resets whenever the service restarts**. The service therefore starts with six made-up sample contacts so the Swagger page is not empty. Set `SEED=false` to turn that off.
- Phone numbers are validated loosely (digits, spaces, brackets and dashes with an optional leading `+`, about 7-20 characters) because formats differ by country. Email is checked for the basic `name@host.tld` shape only.
- Ids are integers counted up from 1. They are never reused after a delete, within one run.

## Issues encountered

- **In-memory data does not fit serverless hosting.** On a platform that runs each request in a possibly different short-lived instance (Vercel functions, for example), one request's `POST` may not be visible to the next `GET`. This API therefore targets a platform that keeps a **single long-running Node process** (Render, Azure App Service, Railway, ...).
- **Free hosting sleeps.** A free Render service spins down after a period without traffic, so the first request after that is slow and the data resets to the sample contacts. Opening `/health` once before a demo wakes it.
- **The live URL has a random suffix.** `https://address-book-api.onrender.com` is not this service (it answers 404), so Render gave it the subdomain `address-book-api-tmeq`. Use the link at the top of this README.
- **A sorting bug caught by the tests.** The six sample contacts are created within the same millisecond, so sorting by `createdAt` descending left them in ascending order: the tie-breaker (id) was not flipped with the direction. It is now, and a test covers it.
- **`node --test test/` fails on Node 24.** Node treated the folder as a module to run. The `test` script is plain `node --test`, which finds the tests by itself and works on Node 20 and newer.

## Deploying (Render)

1. Push this repository to GitHub.
2. On [render.com](https://render.com): **New + → Blueprint**, pick the repository. `render.yaml` already holds the settings (Node, `npm ci`, `npm start`, health check `/health`, free plan).
   - Without the Blueprint: **New + → Web Service**, build command `npm ci`, start command `npm start`.
3. When the deploy finishes, open `https://<service>.onrender.com/api-docs`.

Render sets `PORT` itself, and the server reads it. Any other host that runs `npm start` on a persistent Node process works the same way.

## Tests

`npm test` starts the real app on a random port for each test and calls it over HTTP. It covers create, read, replace, patch, delete, favorites, search, sort, paging, validation errors, malformed JSON, 404 handling, the Swagger page, and a check that the OpenAPI document matches the routes.
