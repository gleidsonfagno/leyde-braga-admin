import { requirePageSession } from '../../lib/page-auth';
import { AdminShell } from '../../components/admin-shell';

export const dynamic = 'force-dynamic';
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requirePageSession();
  return <AdminShell>{children}</AdminShell>;
}
