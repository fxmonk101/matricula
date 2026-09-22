# Deploying Matricula

A runbook for putting this application on the internet: **Neon** for Postgres,
**Cloudflare R2** for uploaded files, **Vercel** for the application itself.

Written for whoever is doing the deployment, working from a clean machine with
the repository checked out. It assumes no prior account on any of the three.

Do the steps in the order given. Each one produces a value the next one needs,
and the application will not start until all three exist.

---

## 0. Read this first — two things are not ready

**The R2 storage driver has not been written.** `src/server/storage/` contains
the interface and a local-disk implementation only, and the resolver throws for
anything else:

```
STORAGE_DRIVER="s3" is not implemented. Use "local", or add the S3 driver before deploying.
```

Vercel's filesystem is read-only apart from `/tmp`, which is per-instance and
discarded. Deploying without the driver means every avatar, course material and
student submission uploads successfully and is gone by the next request — which
is worse than failing, because it looks like it worked. **Section 2 sets up the
bucket; the driver is still owed.**

**The upload ceiling needs a decision.** Vercel refuses a serverless request
body over roughly 4.5 MB at the platform edge, before any application code runs.
`SUBMISSION_LIMITS` in `src/lib/domain/upload.ts` currently allows 20 MB. See
§5.3 for the two ways out.

Everything else below is ready and has been checked against the code.

---

## 1. Neon — the database

### 1.1 Create the project

1. Sign up at **neon.tech**.
2. Create a project.
3. **Region: `eu-central-1` (Frankfurt).** Do not skip this — see the note at
   the end of this section.
4. Postgres version: the default is fine.

### 1.2 Take both connection strings

Neon offers two, and this application needs both. On the project dashboard,
under **Connection string**, copy the **Pooled connection** and then toggle
*Connection pooling* off and copy the **Direct connection**.

```
# Pooled — note the "-pooler" in the host. This is what the app runs on.
postgresql://user:pass@ep-xxx-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require

# Direct — no "-pooler". Migrations use this.
postgresql://user:pass@ep-xxx.eu-central-1.aws.neon.tech/neondb?sslmode=require
```

**Why both.** Every serverless invocation opens its own connection pool. A few
dozen concurrent requests will exhaust Postgres's connection limit and the site
starts returning 500s under exactly the load you want it to survive. The pooled
endpoint puts PgBouncer in front and fixes that. But PgBouncer in transaction
mode cannot run schema migrations, so `prisma migrate` needs the direct one.

### 1.3 Switch the schema to Postgres

In `prisma/schema.prisma`:

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}
```

`directUrl` is new — add the line. Prisma uses it for migrations and `db push`
and leaves the pooled `url` for queries.

The rest of the schema needs no changes. It was written to be portable — enums
are `String` columns validated by Zod, money is integer minor units — and
`prisma validate` passes against the Postgres provider unmodified.

Case-insensitive search is also already handled: `src/lib/search-filter.ts`
reads the provider off `DATABASE_URL` and emits `mode: 'insensitive'` only on
Postgres. Nothing to change, but be aware that this is why search keeps working
after the switch.

### 1.4 Regenerate the migration history

The six directories in `prisma/migrations/` are SQLite SQL and
`migration_lock.toml` pins the provider. They cannot be applied to Postgres.

There is no production data yet, so the clean move is to start the history over:

```bash
rm -rf prisma/migrations
DATABASE_URL="<direct connection string>" npx prisma migrate dev --name init
```

**Do this before your first real school, not after.** Once a live database
exists this stops being a two-minute job.

### 1.5 Seed

```bash
DATABASE_URL="<direct connection string>" npx prisma db seed
```

Then check the output for the platform operator's sign-in details and keep
them somewhere safe.

> **On the region.** Put the database in the same region as the application.
> Prisma issues several queries per page render; functions in Frankfurt talking
> to a database in Virginia pay a transatlantic round trip several times per
> page, and the site feels broken rather than slow. Frankfurt is also the right
> choice for users in Nigeria and Ghana: West African internet reaches the world
> through submarine cables landing in Europe, so Frankfurt is effectively the
> nearest cloud. Do not pick a region by the name on the map.

---

## 2. Cloudflare R2 — uploaded files

Avatars, course materials and student submissions. **R2 charges nothing for
egress**, which matters when the users are pulling lecture PDFs over West
African mobile data.

### 2.1 Create the bucket

1. Sign up at **cloudflare.com**, then open **R2** in the dashboard.
2. R2 requires a payment card on file even for the free allowance. The free
   tier is 10 GB of storage and, notably, unlimited egress.
3. **Create bucket** — name it something like `matricula-files`.
4. Location: **EU**.
5. **Leave public access disabled.** This is important and not the default
   assumption people make. Nothing in this application is served straight from
   the bucket — every read goes through a route handler that checks the
   session and the requester's relationship to the record
   (`src/app/submissions/[submissionId]/file/route.ts` and its siblings). A
   public bucket would make every student submission readable by anyone who
   learned the URL.

### 2.2 Create an API token

**R2 → Manage R2 API Tokens → Create API Token.**

- Permission: **Object Read & Write**
- Scope it to the one bucket, not the whole account.
- TTL: forever.

You get three values, shown **once**:

| Value | Goes into |
|---|---|
| Access Key ID | `S3_ACCESS_KEY_ID` |
| Secret Access Key | `S3_SECRET_ACCESS_KEY` |
| Endpoint (`https://<account-id>.r2.cloudflarestorage.com`) | `S3_ENDPOINT` |

Also note the bucket name for `S3_BUCKET`, and use `auto` for `S3_REGION` —
R2 ignores the region but the S3 protocol requires the field.

### 2.3 The driver

As flagged in §0, `src/server/storage/` has no S3 implementation yet. The
interface is three methods — `put`, `get`, `delete` — and all six call sites go
through it, so this is a contained piece of work and nothing else changes. Until
it exists, the variables above have nothing reading them.

---

## 3. Vercel — the application

### 3.1 Import the repository

1. Push the repository to GitHub.
2. Sign up at **vercel.com** and **Add New → Project**, then import it.
3. Framework preset: **Next.js** (detected automatically).
4. Do not deploy yet — set the environment variables first, or the first build
   will fail in a way that is tedious to read.

### 3.2 Region

**Settings → Functions → Function Region → Frankfurt (`fra1`)**, matching Neon.

### 3.3 Environment variables

**Settings → Environment Variables.** These are every variable the application
reads. Set them for Production, and for Preview if you want preview deployments
to work (give Preview its own Neon branch rather than pointing it at production).

| Variable | Value | Notes |
|---|---|---|
| `DATABASE_URL` | Neon **pooled** string | Note the `-pooler` in the host |
| `DIRECT_URL` | Neon **direct** string | Migrations only |
| `AUTH_SECRET` | 48 random bytes | **Minimum 32 characters** — the app refuses to sign sessions with less |
| `SESSION_TTL_SECONDS` | `28800` | 8 hours; optional, this is the default |
| `OPERATOR_TTL_SECONDS` | `3600` | Shorter for the platform console; optional |
| `TENANCY_MODE` | `subdomain` | Or `path` — see §3.5 |
| `ROOT_DOMAIN` | `yourdomain.com` | **Required for subdomain mode.** No `www`, no scheme |
| `STORAGE_DRIVER` | `s3` | Once the driver exists |
| `S3_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` | |
| `S3_BUCKET` | `matricula-files` | |
| `S3_REGION` | `auto` | |
| `S3_ACCESS_KEY_ID` | from §2.2 | |
| `S3_SECRET_ACCESS_KEY` | from §2.2 | |
| `MAIL_DRIVER` | `resend` | Or `brevo` |
| `MAIL_API_KEY` | from §4 | |
| `MAIL_FROM` | `Matricula <portal@yourdomain.com>` | Must be on a **verified** domain |
| `CRON_SECRET` | 32 random bytes | §3.6 |

Generate the secrets:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Run it twice — `AUTH_SECRET` and `CRON_SECRET` must not be the same value.

Leave `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` and
`AZURE_DEFAULT_ORGANISER` unset. The Teams meeting driver falls back to
`MANUAL` — a lecturer pastes a meeting link — which works with no configuration
at all.

Do **not** set `STORAGE_ROOT` or `NEXT_DIST_DIR`. Both are local development
concerns.

### 3.4 Build settings

Prisma Client must be regenerated on each build, because Vercel caches
`node_modules` and a cached client will be out of step with the schema.

**Settings → General → Build Command:**

```
prisma generate && prisma migrate deploy && next build
```

`migrate deploy` applies pending migrations and never generates new ones, which
is what you want on a production deploy.

### 3.5 Your domain

**Settings → Domains.** Add:

| Domain | Purpose |
|---|---|
| `yourdomain.com` | Marketing site |
| `www.yourdomain.com` | Redirect to the apex |
| `*.yourdomain.com` | **Every school's portal** |

The wildcard is the one that matters. With `TENANCY_MODE=subdomain`, each school
gets its own hostname the moment it is provisioned:

```
www.yourdomain.com       marketing
unilag.yourdomain.com    a school's portal
legon.yourdomain.com     another school's portal
```

`www`, `app`, `admin`, `api` and `portal` are already reserved as non-tenant
hostnames in `src/lib/domain/tenancy.ts`, so no school can take them.

**Wildcard domains require a Vercel Pro plan** (currently $20/month). If you are
not ready for that, set `TENANCY_MODE=path` and schools live at
`yourdomain.com/s/unilag/login` instead. Both modes are fully implemented; it is
one environment variable and a redeploy, so starting on `path` costs you
nothing but the appearance.

DNS records, at whoever you bought the domain from:

```
A      @      76.76.21.21
CNAME  www    cname.vercel-dns.com
CNAME  *      cname.vercel-dns.com
```

Vercel shows the exact values when you add each domain — use the ones it shows,
as they do change. TLS, including for the wildcard, is issued automatically.

If you moved DNS to Cloudflare, set those records to **DNS only** (grey cloud),
not proxied. Proxying in front of Vercel causes redirect loops.

### 3.6 The scheduled sweep

`sweepForgottenSessions` closes presence sessions for staff who signed in and
never signed out. It is written and tested but **nothing currently calls it**,
so without this step those sessions stay open indefinitely and the attendance
records are wrong.

Create `vercel.json` in the repository root:

```json
{
  "crons": [
    { "path": "/api/cron/sweep-presence", "schedule": "0 22 * * *" }
  ]
}
```

That runs at 22:00 UTC — 23:00 in Lagos, after the teaching day. The route
handler it calls still needs writing, and it must check the
`Authorization: Bearer <CRON_SECRET>` header that Vercel sends, or anyone who
finds the URL can close everybody's sessions.

---

## 4. Resend — email

Password reset and email confirmation. Without it those flows still exist but
the application knows it cannot deliver: `mailIsDeliverable()` returns false and
the UI says so rather than claiming a message was sent.

1. Sign up at **resend.com**. The free tier is 3,000 messages a month.
2. **Domains → Add Domain**, enter `yourdomain.com`.
3. Add the DKIM, SPF and DMARC records it gives you to your DNS. **Wait for it
   to verify.** This is the single commonest reason transactional mail silently
   fails — an unverified sender is rejected outright or filed as spam.
4. **API Keys → Create**, permission *Sending access*.
5. Set `MAIL_DRIVER=resend`, `MAIL_API_KEY=<the key>`, and `MAIL_FROM` to an
   address on the domain you just verified.

Choose Brevo instead if you would rather have 300 messages a *day* than 3,000 a
month — a school sending a term's worth of notices in one week hits the monthly
cap and not the daily one. Set `MAIL_DRIVER=brevo`; nothing else differs.

---

## 5. Decisions you have to make

### 5.1 Nothing Vercel-specific

Do not reach for Vercel KV, Vercel Blob or Vercel Postgres. Neon and R2 do the
same jobs, and keeping to them means the application stays a container, a
Postgres and an S3 endpoint — movable in an afternoon.

That matters commercially. Nigeria's NDPA 2023 and federal procurement rules can
require data held in-country, and Vercel has no Nigerian region. If that comes
up in a tender, the answer should be a VPS and a week of work, not a rewrite.

### 5.2 The application is ready for serverless

Worth knowing, because it is not typical and it is why this stack works:
sessions are stateless JWTs in cookies, rate limiting is in a database table
rather than an in-memory bucket, and the only per-process state is the
school-config memo, which documents itself as tolerant of staleness. Nothing is
pinned to one instance.

### 5.3 The upload ceiling

Vercel's ~4.5 MB request body limit is a platform limit. `bodySizeLimit` in
`next.config.mjs` cannot raise it. Two honest options:

- **Lower `SUBMISSION_LIMITS.maxBytes`** in `src/lib/domain/upload.ts` to about
  4 MB. The hand-in form and the module builder derive their wording from that
  constant, so they will tell students the truth automatically, and
  `tests/upload-limits.test.ts` will keep the config in step.
- **Upload straight to R2** from the browser with a presigned URL, skipping the
  server action. Keeps the 20 MB limit. More work, and the right answer
  eventually.

Start with the first. Move to the second when a lecturer complains.

---

## 6. After the first deploy

Check these in order. Each one has failed in testing at some point.

- [ ] `https://yourdomain.com` loads with styling and images.
- [ ] `https://<school>.yourdomain.com/login` reaches that school's sign-in page
      (or `/s/<school>/login` in path mode).
- [ ] Sign in as the platform operator; the console loads.
- [ ] Provision a new school from the console; the entrance URL it returns
      actually works.
- [ ] Sign in as a lecturer and open a course; the LMS modules render.
- [ ] Upload a file as a lecturer and download it back.
- [ ] Submit a piece of coursework as a student, and confirm a **different**
      student on the same course gets a 404 on that submission's file URL.
- [ ] Trigger a password reset and confirm the email arrives.
- [ ] Confirm the favicon and logo are the Matricula crest, not a placeholder.

The seventh is the one to do properly. It is the only check here that catches a
tenancy or authorisation failure, and those are silent.
