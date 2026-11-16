import React from 'react';
import { AdminOverviewView } from '@/components/admin/AdminOverviewView';
import { requireAdminPage } from '@/lib/admin/pageAuth';
import { getAdminOverview } from '@/lib/admin/overview';

export const dynamic = 'force-dynamic';

export default async function AdminOverviewPage() {
  await requireAdminPage();
  const data = await getAdminOverview();
  return <AdminOverviewView initialData={data} />;
}
