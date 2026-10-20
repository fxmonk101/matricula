const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();

(async () => {
  const [schools, users, operators] = await Promise.all([
    db.school.findMany({ select: { id: true, slug: true, name: true } }),
    db.user.findMany({ select: { id: true, email: true, firstName: true, lastName: true } }),
    db.platformAdmin.findMany({ select: { user: { select: { email: true } } } }),
  ]);

  console.log(JSON.stringify({
    schools: schools.map((s) => ({ id: s.id, slug: s.slug, name: s.name })),
    users: users.map((u) => ({ id: u.id, email: u.email, name: `${u.firstName} ${u.lastName}`.trim() })),
    operators: operators.map((o) => o.user.email),
  }, null, 2));

  await db.$disconnect();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
