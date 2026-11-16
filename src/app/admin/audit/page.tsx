import React from 'react';
import { AdminAuditView } from '@/components/admin/AdminAuditView';
import { requireAdminPage } from '@/lib/admin/pageAuth';
import { listAuditLog } from '@/lib/admin/events';

export const dynamic = 'force-dynamic';

export default async function AdminAuditPage() {
  await requireAdminPage();
  const entries = await listAuditLog({ limit: 150 });
  return <AdminAuditView initialEntries={entries} />;
}
