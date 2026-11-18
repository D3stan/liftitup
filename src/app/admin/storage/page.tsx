import React from 'react';
import { AdminStorageView } from '@/components/admin/AdminStorageView';
import { requireAdminPage } from '@/lib/admin/pageAuth';
import { getAdminStorageReport } from '@/lib/admin/storage';

export const dynamic = 'force-dynamic';

export default async function AdminStoragePage() {
  await requireAdminPage();
  const data = await getAdminStorageReport();
  return <AdminStorageView initialData={data} />;
}
