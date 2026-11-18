import React from 'react';
import { AdminShell } from '@/components/admin/AdminShell';
import { requireAdminPage } from '@/lib/admin/pageAuth';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const adminUser = await requireAdminPage();
  return <AdminShell adminUser={adminUser}>{children}</AdminShell>;
}
