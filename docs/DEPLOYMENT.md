# Going live: Supabase + Vercel

Written to be followed in order. Each step says what it is for, because the
ones that look optional are the ones that break a week later under real load.

---

## 1. Supabase — the database

Create a project at [supabase.com](https://supabase.com). Choose the region
closest to your users; for West African universities that is usually
`eu-west-2` (London) or `eu-central-1` (Frankfurt), both of which are markedly
closer than any US region.

Then take **two** connection strings from *Project Settings → Database →
Connection string*. You need both, and they are not interchangeable:

| Variable | Port | Used by | Why |
|---|---|---|---|
| `DATABASE_URL` | 6543 | the running app | Pooled, through pgbouncer |
| `DIRECT_URL` | 5432 | `prisma migrate` only | DDL and advisory locks |

```
DATABASE_URL="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"
DIRECT_URL="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres"
```

**`?pgbouncer=true` is not optional.** Prisma uses prepared statements; pgbouncer
in transaction mode does not support them, and without the flag you get
intermittent `prepared statement "s0" already exists` errors that appear only
under concurrency — which means they appear in production and not in testing.

**`connection_limit=1` is not optional either.** Every serverless invocation
opens its own pool. With the default limit, a hundred concurrent requests ask
Postgres for hundreds of connections and it refuses them all, including the
ones already queued.

---

## 2. Apply the schema

```bash
npx prisma migrate deploy
```

This creates 64 tables, 52 unique indexes and 102 foreign keys.

Then create the first school and the first platform operator. The seed builds a
full demonstration platform — three schools, students, grades, invoices — which
is what you want for a demo and **not** what you want on a production database:

```bash
npm run db:seed          # demo data. NEVER against a live customer database.
```

For a real deployment, skip the seed and create the first operator by hand:

```sql
-- After signing up through the app once, promote that account:
insert into platform_admins (id, "userId", "createdAt")
values (gen_random_uuid()::text, '<the user id>', now());
```

---

## 3. Vercel

Import the repository. Vercel detects Next.js; the build command is already set
in `package.json`:

```
prisma generate && prisma migrate deploy && next build
```

Migrations run at build time deliberately: a deployment whose code expects a
column that does not exist yet is worse than a deployment that fails to build.

### Environment variables

Set these in *Project Settings → Environment Variables*:

| Variable | Value | Notes |
|---|---|---|
| `DATABASE_URL` | pooled Supabase string | see above |
| `DIRECT_URL` | direct Supabase string | see above |
| `AUTH_SECRET` | 48 random bytes | **generate a NEW one; do not reuse the development value** |
| `SESSION_TTL_SECONDS` | `28800` | 8 hours |
| `TENANCY_MODE` | `path` or `subdomain` | see below |
| `ROOT_DOMAIN` | your domain | subdomain mode only |

Generate the secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

The app refuses to sign a session with a key shorter than 32 characters rather
than doing it quietly. Rotating `AUTH_SECRET` signs every live session out,
which is exactly what you do if it is ever exposed.

### Giving each school its own address

`TENANCY_MODE=path` gives every school `yourdomain.com/s/<slug>/login`. This
works everywhere and needs no DNS.

`TENANCY_MODE=subdomain` plus `ROOT_DOMAIN=yourdomain.com` gives each school
`<slug>.yourdomain.com`. Add a wildcard domain `*.yourdomain.com` in Vercel and
a wildcard CNAME at your DNS provider. Path links keep working afterwards, so
addresses already printed in a prospectus do not break.

---

## Known limits before you sell this

Stated plainly, because finding them after a signature is worse.

**File uploads do not work on Vercel yet.** The storage layer
(`src/server/storage/`) has a driver interface and a local-disk implementation.
Vercel's filesystem is read-only apart from `/tmp`, and `/tmp` does not survive
between invocations. A Supabase Storage or S3 driver behind the same interface
is needed before school logos or application documents can be uploaded. Reading
files already works; writing does not.

**No email.** Password resets go through the office by design — an administrator
issues a one-time password and hands it over — so there is no mail dependency in
the critical path. If you want self-service reset, that needs a mail provider.

**The database-backed tests need a Postgres URL.** `tests/tenant.test.ts` and
`tests/platform.test.ts` run against a real database. Point `DATABASE_URL` at a
scratch Supabase project (not production — they create and delete rows) and
they run; otherwise they skip and the suite reports 714 of 761.

**Content-Security-Policy still carries `script-src 'unsafe-inline'`.** Next's
App Router streams its bootstrap through inline scripts; removing it needs
per-request nonces threaded through the document. Recorded as owed, not fixed.

---

## A note on Supabase Auth

This app does **not** use Supabase Auth, and I would not move it there without a
concrete reason. What it uses instead:

- JWT sessions signed with `jose`, verified in edge middleware
- bcrypt at cost factor 12
- Two-key sliding-window rate limiting on sign-in, keyed by both identifier and
  address, so one attacker cannot lock out a legitimate user
- A forced password-change gate on every authenticated route
- Every sign-in written to the audit log

The mismatch is structural rather than cosmetic. **Identity here is global but
authorisation is per-school**: one person holds a `Membership` at each
institution, with a different role at each — a Dean at one university and a
Lecturer at another. Supabase Auth models a user as globally one thing, so the
`Membership` table and every role check would remain exactly as they are, and
Supabase would only replace the password check and the session cookie. That is
the smallest and best-tested part of what is written.

Supabase's **Postgres** is a straightforward win and this guide uses it.
Supabase's **Auth** would be a rewrite of working, tested security machinery in
exchange for an email-based reset flow the product deliberately does not want.

If you want it anyway — for social sign-in, or institutional SSO, which are real
reasons — say so and I will do it. It is roughly a day's work and touches
sign-in, middleware, the session claims and the seed.
