import type { Metadata } from 'next';
import Link from 'next/link';

import { requireTenantRole } from '@/server/tenant-context';
import { PageHeader } from '@/components/ui';
import { ImportPanel } from './import-panel';

export const metadata: Metadata = { title: 'Import people' };

/**
 * Bulk import.
 *
 * The thing that decides whether a real university can start using this at all.
 * A registry has its intake in a spreadsheet and is not going to type two
 * thousand students into a form one at a time — before this existed, that was
 * the honest answer to "how do we get our students in".
 */
export default async function ImportPage() {
  await requireTenantRole('OWNER', 'ADMIN', 'REGISTRAR');

  return (
    <>
      <PageHeader
        title="Import people"
        description="Create student or staff accounts from a spreadsheet."
        actions={
          <Link href="/people" className="text-xs font-medium text-brand-700 hover:underline">
            ← People
          </Link>
        }
      />
      <ImportPanel />
    </>
  );
}
