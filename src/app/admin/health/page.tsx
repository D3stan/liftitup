import React from 'react';
import { AdminHealthView } from '@/components/admin/AdminHealthView';
import { requireAdminPage } from '@/lib/admin/pageAuth';
import { getAdminSystemHealth } from '@/lib/admin/health';

export const dynamic = 'force-dynamic';

export default async function AdminHealthPage() {
  await requireAdminPage();
  const data = await getAdminSystemHealth();
  return <AdminHealthView initialData={data} />;
}
