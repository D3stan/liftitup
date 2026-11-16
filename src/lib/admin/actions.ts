import { ApiError } from '@/lib/api/handler';
import { purgeExpiredGuestsIfDue } from '@/lib/auth/sandbox';
import { withTransaction } from '@/lib/db/connection';
import {
  deleteApiKeyByUserId,
  deleteAuthSessionsByUserId,
} from '@/lib/db/sessions';
import { deleteUserAccountInTx } from '@/lib/db/userDeletion';
import {
  getUserById,
  setUserDisabledFlag,
  setUserPhotoQuota,
} from '@/lib/db/users';
import {
  buildUserExportJson,
  getExportFilename,
  type ExportJsonPayload,
} from '@/lib/export';
import {
  mergeActorAuditDetail,
  recordAuditLog,
  safeRecordEvent,
  type AdminActor,
} from './events';
import { computeAndSaveDailySnapshot } from './snapshot';

export async function setUserDisabledState(input: {
  targetUserId: string;
  disabled: boolean;
  reason?: string | null;
  actor: AdminActor;
}): Promise<{ userId: string; isDisabled: boolean; revokedSessions: number; auditId: string }> {
  if (input.disabled && input.actor.actorUserId === input.targetUserId) {
    throw ApiError.validation('Cannot disable your own admin account');
  }

  return await withTransaction(async () => {
    const existing = await getUserById(input.targetUserId);
    if (!existing) {
      throw ApiError.notFound('User not found');
    }

    await setUserDisabledFlag(input.targetUserId, input.disabled);
    const revokedSessions = input.disabled
      ? await deleteAuthSessionsByUserId(input.targetUserId)
      : 0;

    const audit = await recordAuditLog({
      actorUserId: input.actor.actorUserId ?? null,
      actorLabel: input.actor.actorLabel,
      source: input.actor.source,
      action: input.disabled ? 'disable_user' : 'enable_user',
      targetUserId: input.targetUserId,
      reason: input.reason ?? null,
      detail: mergeActorAuditDetail(input.actor, { revokedSessions }),
    });

    return {
      userId: input.targetUserId,
      isDisabled: input.disabled,
      revokedSessions,
      auditId: audit.id,
    };
  });
}

export async function forceLogoutUser(input: {
  targetUserId: string;
  actor: AdminActor;
}): Promise<{ userId: string; revokedSessions: number; auditId: string }> {
  return await withTransaction(async () => {
    const existing = await getUserById(input.targetUserId);
    if (!existing) {
      throw ApiError.notFound('User not found');
    }
    const revokedSessions = await deleteAuthSessionsByUserId(input.targetUserId);
    const audit = await recordAuditLog({
      actorUserId: input.actor.actorUserId ?? null,
      actorLabel: input.actor.actorLabel,
      source: input.actor.source,
      action: 'force_logout',
      targetUserId: input.targetUserId,
      detail: mergeActorAuditDetail(input.actor, { revokedSessions }),
    });
    return { userId: input.targetUserId, revokedSessions, auditId: audit.id };
  });
}

export async function revokeUserApiKey(input: {
  targetUserId: string;
  actor: AdminActor;
}): Promise<{ userId: string; revoked: boolean; auditId: string }> {
  return await withTransaction(async () => {
    const existing = await getUserById(input.targetUserId);
    if (!existing) {
      throw ApiError.notFound('User not found');
    }
    const revoked = await deleteApiKeyByUserId(input.targetUserId);
    const audit = await recordAuditLog({
      actorUserId: input.actor.actorUserId ?? null,
      actorLabel: input.actor.actorLabel,
      source: input.actor.source,
      action: 'revoke_api_key',
      targetUserId: input.targetUserId,
      detail: mergeActorAuditDetail(input.actor, { revoked }),
    });
    return { userId: input.targetUserId, revoked, auditId: audit.id };
  });
}

export async function adjustUserPhotoQuota(input: {
  targetUserId: string;
  photoQuota: number | null;
  actor: AdminActor;
}): Promise<{ userId: string; photoQuota: number | null; auditId: string }> {
  if (input.photoQuota !== null) {
    if (
      typeof input.photoQuota !== 'number' ||
      !Number.isInteger(input.photoQuota) ||
      input.photoQuota < 0 ||
      input.photoQuota > 10_000
    ) {
      throw ApiError.validation(
        'photoQuota must be null or an integer between 0 and 10000',
      );
    }
  }

  return await withTransaction(async () => {
    const existing = await getUserById(input.targetUserId);
    if (!existing) {
      throw ApiError.notFound('User not found');
    }
    const updated = await setUserPhotoQuota(input.targetUserId, input.photoQuota);
    const audit = await recordAuditLog({
      actorUserId: input.actor.actorUserId ?? null,
      actorLabel: input.actor.actorLabel,
      source: input.actor.source,
      action: 'adjust_photo_quota',
      targetUserId: input.targetUserId,
      detail: mergeActorAuditDetail(input.actor, {
        previousQuota: existing.photoQuota ?? null,
        newQuota: updated?.photoQuota ?? null,
      }),
    });
    return {
      userId: input.targetUserId,
      photoQuota: updated?.photoQuota ?? null,
      auditId: audit.id,
    };
  });
}

export async function adminDeleteUser(input: {
  targetUserId: string;
  actor: AdminActor;
}): Promise<{ userId: string; deleted: boolean; auditId: string }> {
  if (input.actor.actorUserId === input.targetUserId) {
    throw ApiError.validation('Cannot delete your own admin account');
  }

  return await withTransaction(async () => {
    const existing = await getUserById(input.targetUserId);
    if (!existing) {
      throw ApiError.notFound('User not found');
    }

    // Reuses Phase 1 explicit child-to-parent deletion order.
    // Crucially, events and audit_log have no FK cascade and are preserved.
    const deleted = await deleteUserAccountInTx(input.targetUserId);
    const audit = await recordAuditLog({
      actorUserId: input.actor.actorUserId ?? null,
      actorLabel: input.actor.actorLabel,
      source: input.actor.source,
      action: 'delete_user',
      targetUserId: input.targetUserId,
      detail: mergeActorAuditDetail(input.actor, {
        username: existing.username,
        isGuest: existing.isGuest,
      }),
    });
    return { userId: input.targetUserId, deleted, auditId: audit.id };
  });
}

export async function adminPurgeExpiredGuests(input: {
  actor: AdminActor;
}): Promise<{ purgedCount: number; auditId: string }> {
  const purgedCount = await purgeExpiredGuestsIfDue(true);
  const audit = await recordAuditLog({
    actorUserId: input.actor.actorUserId ?? null,
    actorLabel: input.actor.actorLabel,
    source: input.actor.source,
    action: 'purge_guests',
    detail: mergeActorAuditDetail(input.actor, { purgedCount }),
  });
  return { purgedCount, auditId: audit.id };
}

export async function adminRefreshDailySnapshot(input: {
  actor: AdminActor;
}): Promise<{ snapshotDate: string; computedAt: string; auditId: string }> {
  const snapshot = await computeAndSaveDailySnapshot();
  const audit = await recordAuditLog({
    actorUserId: input.actor.actorUserId ?? null,
    actorLabel: input.actor.actorLabel,
    source: input.actor.source,
    action: 'refresh_snapshot',
    detail: mergeActorAuditDetail(input.actor, {
      snapshotDate: snapshot.snapshotDate,
    }),
  });
  return {
    snapshotDate: snapshot.snapshotDate,
    computedAt: snapshot.computedAt,
    auditId: audit.id,
  };
}

/**
 * Audited admin data export: requires a typed reason (min 3 chars), logs to
 * `audit_log` with the reason, and delegates to `buildUserExportJson`
 * (which excludes progress photos and never includes admin tables).
 */
export async function adminExportUserData(input: {
  targetUserId: string;
  reason: string;
  actor: AdminActor;
}): Promise<{
  filename: string;
  data: ExportJsonPayload;
  auditId: string;
}> {
  const trimmedReason =
    typeof input.reason === 'string' ? input.reason.trim() : '';
  if (trimmedReason.length < 3 || trimmedReason.length > 500) {
    throw ApiError.validation(
      'Export reason is required (3 to 500 characters)',
    );
  }

  const user = await getUserById(input.targetUserId);
  if (!user) {
    throw ApiError.notFound('User not found');
  }

  const data = await buildUserExportJson(user);
  const filename = getExportFilename(user, 'json');

  const audit = await recordAuditLog({
    actorUserId: input.actor.actorUserId ?? null,
    actorLabel: input.actor.actorLabel,
    source: input.actor.source,
    action: 'export_user_data',
    targetUserId: user.id,
    reason: trimmedReason,
    detail: mergeActorAuditDetail(input.actor, {
      sessionCount: data.sessions.length,
    }),
  });

  await safeRecordEvent({
    userId: user.id,
    eventType: 'admin_export',
    detail: { actorSource: input.actor.source },
  });

  return { filename, data, auditId: audit.id };
}
