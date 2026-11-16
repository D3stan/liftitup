import React from 'react';
import { notFound } from 'next/navigation';
import { AdminUserDetailView } from '@/components/admin/AdminUserDetailView';
import { requireAdminPage } from '@/lib/admin/pageAuth';
import { getAdminUserDetail } from '@/lib/admin/userDetail';
import { ApiError } from '@/lib/api/handler';

export const dynamic = 'force-dynamic';

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const adminUser = await requireAdminPage();
  const { id } = await params;

  let detail;
  try {
    detail = await getAdminUserDetail(id, {
      actorUserId: adminUser.id,
      actorLabel: adminUser.username,
      source: 'admin_web',
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      notFound();
    }
    throw err;
  }

  return (
    <AdminUserDetailView initialData={detail} currentAdminId={adminUser.id} />
  );
}
