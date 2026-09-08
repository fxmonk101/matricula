import { PrismaClient } from '@prisma/client';
import { signSession } from './src/lib/auth/jwt';
async function main() {
  const db = new PrismaClient();
  for (const arg of process.argv.slice(2)) {
    const [slug, email] = arg.split('|');
    const school = await db.school.findUnique({ where: { slug } });
    const user = await db.user.findUnique({ where: { email } });
    if (!school || !user) { console.log(`${arg}\tMISSING`); continue; }
    const m = await db.membership.findFirst({ where: { userId: user.id, schoolId: school.id } });
    if (!m) { console.log(`${arg}\tNO MEMBERSHIP`); continue; }
    const inst = await db.instructor.findFirst({ where: { userId: user.id, schoolId: school.id } });
    const stu = await db.student.findFirst({ where: { userId: user.id, schoolId: school.id } });
    console.log(`${arg}\t${m.role}\t` + await signSession({
      sub: user.id, email: user.email, name: `${user.firstName} ${user.lastName}`,
      sch: school.id, mbr: m.id, role: m.role as never, slug: school.slug,
      pid: inst?.id ?? stu?.id ?? null, pa: false,
    } as never));
  }
  await db.$disconnect();
}
main();
