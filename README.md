# NextGen Status Boost — VCF Registration Campaign

A self-contained crowdfund-style contact collection campaign. Visitors register their
WhatsApp number, watch a live progress bar climb toward a target, and once the target
is hit everyone can download a single compiled `.vcf` file containing every registered
contact — importing it adds every participant to their phonebook at once, which
unlocks mutual WhatsApp Status visibility for the whole group.

## Stack

- **Backend:** Node.js + Express
- **Database:** SQLite, via Node's built-in `node:sqlite` module (no native compilation
  required — works out of the box on Node **22.5+**)
- **Frontend:** Plain HTML/CSS/JS single-page app (no build step, no framework)

## Project structure

```
vcf-project/
├── server.js              # Express server: API routes, DB, VCF compiler
├── package.json
├── public/
│   ├── index.html          # Public registration page (Sections A, B, C)
│   └── admin.html          # Private admin control panel
└── vcf_database.db         # Created automatically on first run
```

## Running it

```bash
npm install
npm start
```

Then open:

- **Public site:** `http://localhost:3000/index.html`
- **Admin panel:** `http://localhost:3000/admin.html`

The server listens on `PORT` env var if set, otherwise `3000`.

> **Note on hosting:** because this relies on `node:sqlite`, deploy to a host running
> **Node 22.5 or newer**. If your host is stuck on an older Node version, swap the
> `node:sqlite` calls in `server.js` for `better-sqlite3` instead (same API shape,
> just needs a native build step at install time).

## Securing the admin panel

`admin.html` is reachable by anyone who knows the URL — there's no login by design
(per the brief, "obfuscated URL endpoint"). For real campaigns you should:

- Rename `admin.html` to something unguessable, **and/or**
- Put the `/admin.html` and `/api/admin/*` routes behind basic auth or a reverse-proxy
  rule before going live, since currently anyone with the link can change the target
  or wipe all data.

## API reference

| Method | Route                 | Purpose                                              |
|--------|-----------------------|-------------------------------------------------------|
| GET    | `/api/status`          | `{ count, target }` — polled every 6s by the public page |
| POST   | `/api/register`        | `{ name, phone }` → registers a contact               |
| GET    | `/api/download`        | Streams the compiled `.vcf` (403 until target is met)  |
| POST   | `/api/admin/target`    | `{ target }` → updates the campaign goal               |
| POST   | `/api/admin/reset`     | Wipes all contacts, resets counter to 0                 |
| GET    | `/api/admin/state`     | `{ count, target }` — used by the admin panel           |

## How registration validation works

1. **Sanitize:** strips spaces and dashes from the submitted phone number.
2. **Validate:** rejects anything that doesn't start with `+` (must include country
   code), and requires 6–15 digits after it.
3. **Insert:** SQLite's `UNIQUE` constraint on `phone` blocks duplicate signups —
   the server catches that and returns `"Number already registered!"`.

## How the VCF file is built

For every contact row, the server builds one vCard block:

```
BEGIN:VCARD
VERSION:3.0
N:;Gain 12 (Alex Brand);;;
FN:Gain 12 (Alex Brand)
TEL;TYPE=CELL:+256701234567
END:VCARD
```

All blocks are concatenated into a single in-memory string and streamed back with:

```
Content-Type: text/vcard
Content-Disposition: attachment; filename=whatsapp_gain_list.vcf
```

which forces the browser/phone to save it as a file rather than render it.
