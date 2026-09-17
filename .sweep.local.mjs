import { PrismaClient } from '@prisma/client';
import { SignJWT } from 'jose';
import { readFileSync } from 'node:fs';
for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)\s*=\s*"?([^"\n\r]*)"?/);
  if (m) process.env[m[1]] ??= m[2];
}
const prisma = new PrismaClient();
const key = new TextEncoder().encode(process.env.AUTH_SECRET);
async function mint(m) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ sub: m.userId, email: m.user.email, name: 'x', sch: m.schoolId, mbr: m.id, role: m.role, slug: m.school.slug })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setIssuedAt(now).setNotBefore(now)
    .setExpirationTime(now + 3600).setIssuer('golden-eagles-university').setAudience('geu-portal').sign(key);
}
const paths = process.argv.slice(2);
const emails = ['admin@geu.edu','registrar@geu.edu','a.okafor@geu.edu','b.adewale@geu.edu','e.balogun@geu.edu','i.nwachukwu@geu.edu','o.eze@geu.edu','chidi.eze@student.geu.edu','bursary@geu.edu'];
let bad = 0;
for (const email of emails) {
  const u = await prisma.user.findUnique({ where: { email } });
  if (!u) { console.log(email + ' — missing'); continue; }
  const m = await prisma.membership.findFirst({ where: { userId: u.id }, include: { user: true, school: true } });
  const token = await mint(m);
  for (const path of paths) {
    const res = await fetch(`http://localhost:3000${path}`, { headers: { cookie: `geu_session=${token}` }, redirect: 'manual' });
    const loc = res.headers.get('location') ?? '';
    let flag = '';
    if (res.status >= 500) { flag = ' <<< SERVER ERROR'; bad++; }
    else if (res.status === 200) {
      const body = await res.text();
      if (body.includes('Cannot read properties of undefined') || body.includes('__next_error__')) { flag = ' <<< RENDER ERROR'; bad++; }
    }
    console.log(`${m.role.padEnd(11)} ${email.padEnd(26)} ${String(res.status).padEnd(4)} ${path}${loc ? ' -> ' + loc : ''}${flag}`);
  }
}
console.log(bad === 0 ? '\nOK — no errors' : `\n${bad} BROKEN`);
await prisma.$disconnect();
