import React from 'react';
import { AdminAdoptionView } from '@/components/admin/AdminAdoptionView';
import { requireAdminPage } from '@/lib/admin/pageAuth';
import { getAdminAdoptionReport } from '@/lib/admin/adoption';

export const dynamic = 'force-dynamic';

export default async function AdminAdoptionPage() {
  await requireAdminPage();
  const data = await getAdminAdoptionReport();
  return <AdminAdoptionView initialData={data} />;
}
