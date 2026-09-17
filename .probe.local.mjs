import { PrismaClient } from '@prisma/client';
import { SignJWT } from 'jose';
import { readFileSync } from 'node:fs';
for (const l of readFileSync('.env','utf8').split('\n')) { const m=l.match(/^([A-Z_]+)\s*=\s*"?([^"\n\r]*)"?/); if(m) process.env[m[1]] ??= m[2]; }
const prisma = new PrismaClient();
const key = new TextEncoder().encode(process.env.AUTH_SECRET);
const u = await prisma.user.findUnique({ where: { email: process.argv[2] } });
const m = await prisma.membership.findFirst({ where: { userId: u.id }, include: { user: true, school: true } });
const now = Math.floor(Date.now()/1000);
const token = await new SignJWT({ sub:m.userId, email:m.user.email, name:'x', sch:m.schoolId, mbr:m.id, role:m.role, slug:m.school.slug })
  .setProtectedHeader({alg:'HS256',typ:'JWT'}).setIssuedAt(now).setNotBefore(now).setExpirationTime(now+3600)
  .setIssuer('golden-eagles-university').setAudience('geu-portal').sign(key);
const body = await (await fetch(`http://localhost:3000${process.argv[3]}`, { headers:{cookie:`geu_session=${token}`} })).text();
for (const [label, needle, expect] of JSON.parse(process.argv[4])) {
  const found = body.includes(needle);
  const ok = expect === 'present' ? found : !found;
  console.log(`${ok?'OK  ':'FAIL'}  ${label} (${expect}, ${found?'found':'absent'})`);
}
await prisma.$disconnect();
