import 'server-only';

/**
 * Human-readable document numbers.
 *
 * Multi-tenancy changes the shape: every number now carries the school's code,
 * so `INV-GEU-2025-000001` and `INV-MIT-2025-000001` are visibly different
 * documents belonging to different institutions. Without the prefix, two
 * schools would mint identical-looking numbers and any human comparing them —
 * a bursar, an auditor, a student with two offer letters — would be misled.
 *
 * The sequence itself comes from counting existing rows for the year. Because
 * the client passed in is tenant-scoped, that count is already per-school.
 * That is correct under SQLite (single writer) and under Postgres at
 * SERIALIZABLE, but NOT collision-proof under READ COMMITTED with concurrent
 * writers: two transactions can read the same count.
 *
 * The safety net is the UNIQUE constraint on each number column, now
 * `@@unique([schoolId, invoiceNo])`. A collision becomes a P2002 the caller
 * can retry, never a duplicate document. For high write volume, replace the
 * count with a dedicated sequence table; the interface here stays the same.
 */

/**
 * Structural type for the tenant-scoped transaction client. Declared narrowly
 * rather than importing `Prisma.TransactionClient` because the extended client
 * returns its own transaction type, and only these four counts are needed.
 */
export interface SequenceClient {
  invoice: { count(args: unknown): Promise<number> };
  payment: { count(args: unknown): Promise<number> };
  application: { count(args: unknown): Promise<number> };
  student: { count(args: unknown): Promise<number> };
}

function pad(n: number, width = 6): string {
  return String(n).padStart(width, '0');
}

export async function nextInvoiceNumber(
  tx: SequenceClient,
  schoolCode: string,
  year = new Date().getFullYear(),
): Promise<string> {
  const prefix = `INV-${schoolCode.toUpperCase()}-${year}-`;
  const count = await tx.invoice.count({ where: { invoiceNo: { startsWith: prefix } } });
  return `${prefix}${pad(count + 1)}`;
}

export async function nextReceiptNumber(
  tx: SequenceClient,
  schoolCode: string,
  year = new Date().getFullYear(),
): Promise<string> {
  const prefix = `RCP-${schoolCode.toUpperCase()}-${year}-`;
  const count = await tx.payment.count({ where: { receiptNo: { startsWith: prefix } } });
  return `${prefix}${pad(count + 1)}`;
}

export async function nextApplicationReference(
  tx: SequenceClient,
  schoolCode: string,
  year = new Date().getFullYear(),
): Promise<string> {
  const prefix = `APP-${schoolCode.toUpperCase()}-${year}-`;
  const count = await tx.application.count({ where: { referenceNo: { startsWith: prefix } } });
  return `${prefix}${pad(count + 1)}`;
}

/**
 * Sequence within (department, year) for a matriculation number. The school
 * prefix is added by `buildMatricNumber`, which owns the overall format.
 */
export async function nextMatricSequence(
  tx: SequenceClient,
  departmentCode: string,
  year: number,
): Promise<number> {
  const count = await tx.student.count({
    where: { matricNumber: { contains: `/${departmentCode.toUpperCase()}/${year}/` } },
  });
  return count + 1;
}
