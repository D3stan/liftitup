import { DEFAULT_PHOTO_QUOTA } from '@/lib/photos/constants';
import {
  ensureDailySnapshotIfDue,
  type SnapshotUserRowCounts,
  type TableSizeMetric,
} from './snapshot';

export interface AdminUserStorageEntry {
  userId: string;
  username: string;
  displayName: string;
  isGuest: boolean;
  isDisabled: boolean;
  lastActiveAt: string;
  createdAt: string;
  counts: SnapshotUserRowCounts;
  estimatedDbBytes: number;
  photos: {
    count: number;
    totalBytes: number;
    quota: number;
    quotaUsedPct: number;
    nearLimit: boolean;
  };
  totalEstimatedBytes: number;
}

export interface GuestFootprintSummary {
  totalGuests: number;
  expiredGuests: number;
  guestTtlHours: number;
  totalEstimatedBytes: number;
  reclaimableBytes: number;
}

export interface AdminStorageReport {
  generatedAt: string;
  snapshotComputedAt: string | null;
  totalDbBytes: number;
  tableSizes: TableSizeMetric[];
  users: AdminUserStorageEntry[];
  nearQuotaUsers: AdminUserStorageEntry[];
  guestFootprint: GuestFootprintSummary;
}

const GUEST_TTL_HOURS = 24;
const NEAR_QUOTA_THRESHOLD_PCT = 80;

export async function getAdminStorageReport(): Promise<AdminStorageReport> {
  const snapshot = await ensureDailySnapshotIfDue();
  const nowMs = Date.now();
  const guestCutoffIso = new Date(
    nowMs - GUEST_TTL_HOURS * 60 * 60 * 1000,
  ).toISOString();

  const users: AdminUserStorageEntry[] = (snapshot?.perUserStorage ?? []).map(
    (u) => {
      const quota = u.photoQuota ?? DEFAULT_PHOTO_QUOTA;
      const quotaUsedPct =
        quota > 0
          ? Math.round((u.photoCount / quota) * 1000) / 10
          : u.photoCount > 0
            ? 100
            : 0;
      return {
        userId: u.userId,
        username: u.username,
        displayName: u.displayName,
        isGuest: u.isGuest,
        isDisabled: u.isDisabled,
        lastActiveAt: u.lastActiveAt,
        createdAt: u.createdAt,
        counts: u.counts,
        estimatedDbBytes: u.estimatedDbBytes,
        photos: {
          count: u.photoCount,
          totalBytes: u.photoBytes,
          quota,
          quotaUsedPct,
          nearLimit: !u.isGuest && quotaUsedPct >= NEAR_QUOTA_THRESHOLD_PCT,
        },
        totalEstimatedBytes: u.totalEstimatedBytes,
      };
    },
  );

  const nearQuotaUsers = users.filter((u) => u.photos.nearLimit);

  let totalGuests = 0;
  let expiredGuests = 0;
  let totalGuestBytes = 0;
  let reclaimableBytes = 0;

  for (const u of users) {
    if (!u.isGuest) continue;
    totalGuests += 1;
    totalGuestBytes += u.totalEstimatedBytes;
    if (u.lastActiveAt < guestCutoffIso) {
      expiredGuests += 1;
      reclaimableBytes += u.totalEstimatedBytes;
    }
  }

  return {
    generatedAt: new Date(nowMs).toISOString(),
    snapshotComputedAt: snapshot?.computedAt ?? null,
    totalDbBytes: snapshot?.totalDbBytes ?? 0,
    tableSizes: snapshot?.tableSizes ?? [],
    users,
    nearQuotaUsers,
    guestFootprint: {
      totalGuests,
      expiredGuests,
      guestTtlHours: GUEST_TTL_HOURS,
      totalEstimatedBytes: totalGuestBytes,
      reclaimableBytes,
    },
  };
}
