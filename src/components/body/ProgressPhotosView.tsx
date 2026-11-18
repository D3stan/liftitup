'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeftRight,
  Camera,
  Download,
  Trash2,
  Upload,
} from 'lucide-react';
import type { PhotosGetResponse } from '@/app/api/photos/route';
import {
  ApiClientError,
  Button,
  Sheet,
  apiFetch,
  toast,
} from '@/components/ui';
import { kgToBodyDisplay } from '@/lib/body/weight';
import { PHOTO_POSES, formatPhotoPoseLabel } from '@/lib/photos/constants';
import type {
  ProgressPhoto,
  ProgressPhotoPose,
  WeightUnit,
} from '@/types/domain';
import { PhotoCaptureSheet } from './PhotoCaptureSheet';
import { PhotoCompareView } from './PhotoCompareView';

export function ProgressPhotosView() {
  const router = useRouter();
  const [data, setData] = useState<PhotosGetResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [poseFilter, setPoseFilter] = useState<'all' | ProgressPhotoPose>('all');
  const [viewMode, setViewMode] = useState<'gallery' | 'compare'>('gallery');

  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureInitialMode, setCaptureInitialMode] = useState<'camera' | 'file'>('camera');

  const [selectedPhoto, setSelectedPhoto] = useState<ProgressPhoto | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<PhotosGetResponse>('/api/photos');
      setData(res);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        router.replace('/welcome');
        return;
      }
      toast.error(err instanceof Error ? err.message : 'Failed to load photos');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const photos = data?.photos ?? [];
  const unit: WeightUnit = data?.unit ?? 'kg';
  const quota = data?.quota ?? { used: 0, limit: 300 };

  const filteredPhotos = useMemo(() => {
    if (poseFilter === 'all') return photos;
    return photos.filter((p) => p.pose === poseFilter);
  }, [photos, poseFilter]);

  const canCompare = useMemo(() => {
    return PHOTO_POSES.some(
      (pose) => photos.filter((p) => p.pose === pose).length >= 2,
    );
  }, [photos]);

  const quotaReached = quota.used >= quota.limit;

  function openAdd(mode: 'camera' | 'file') {
    if (quotaReached) {
      toast.error(`Photo quota reached (${quota.used} / ${quota.limit})`);
      return;
    }
    setCaptureInitialMode(mode);
    setCaptureOpen(true);
  }

  async function handleDeleteSelected() {
    if (!selectedPhoto || deleting) return;
    setDeleting(true);
    try {
      await apiFetch(`/api/photos/${selectedPhoto.id}`, { method: 'DELETE' });
      toast.success('Photo deleted');
      setSelectedPhoto(null);
      setConfirmDelete(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Actions & Quota card */}
      <section className="card flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-marker text-lg text-[var(--ink)]">
              Progress Photos
            </h2>
            <p className="text-xs text-[var(--muted)]">
              Private 3:4 portraits · {quota.used} / {quota.limit} used
            </p>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() =>
                setViewMode((m) => (m === 'gallery' ? 'compare' : 'gallery'))
              }
              disabled={!canCompare && viewMode === 'gallery'}
              className={`flex min-h-[44px] items-center gap-1.5 rounded-xl border-2 border-[var(--line)] px-3 text-sm font-bold disabled:opacity-50 ${
                viewMode === 'compare'
                  ? 'bg-[var(--gold)] text-[var(--btn-gold-fg)]'
                  : 'bg-[var(--surface)] text-[var(--ink)]'
              }`}
            >
              <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
              {viewMode === 'compare' ? 'Gallery' : 'Compare'}
            </button>

            {photos.length > 0 && (
              <a
                href="/api/photos/archive"
                download
                className="btn alt min-h-[44px] gap-1.5 px-3 text-sm no-underline"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                ZIP
              </a>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            onClick={() => openAdd('camera')}
            disabled={!data || quotaReached}
            className="min-h-[44px] gap-1.5"
          >
            <Camera className="h-4 w-4" aria-hidden="true" />
            Take Photo
          </Button>
          <Button
            type="button"
            variant="alt"
            onClick={() => openAdd('file')}
            disabled={!data || quotaReached}
            className="min-h-[44px] gap-1.5"
          >
            <Upload className="h-4 w-4" aria-hidden="true" />
            Upload
          </Button>
        </div>
      </section>

      {viewMode === 'compare' ? (
        <PhotoCompareView photos={photos} unit={unit} />
      ) : (
        <>
          {/* Pose filter */}
          <div className="grid grid-cols-4 gap-1.5" role="group" aria-label="Filter by pose">
            {(['all', ...PHOTO_POSES] as const).map((pose) => {
              const active = poseFilter === pose;
              return (
                <button
                  key={pose}
                  type="button"
                  onClick={() => setPoseFilter(pose)}
                  className={`min-h-[44px] rounded-xl border-2 border-[var(--line)] px-2 text-sm font-bold transition ${
                    active
                      ? 'bg-[var(--gold)] text-[var(--btn-gold-fg)] shadow-[2px_2px_0_var(--shadow-color)]'
                      : 'bg-[var(--card)] text-[var(--muted)]'
                  }`}
                >
                  {pose === 'all' ? 'All' : formatPhotoPoseLabel(pose)}
                </button>
              );
            })}
          </div>

          {/* Thumbnail grid */}
          {loading && !data ? (
            <div className="card py-8 text-center text-sm text-[var(--muted)]">
              Loading photos…
            </div>
          ) : filteredPhotos.length === 0 ? (
            <div className="card py-8 text-center">
              <p className="font-marker text-lg text-[var(--ink)]">
                No progress photos yet
              </p>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Take a photo with the ghost overlay &amp; grid or upload one from
                your library.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {filteredPhotos.map((photo) => (
                <button
                  key={photo.id}
                  type="button"
                  onClick={() => {
                    setConfirmDelete(false);
                    setSelectedPhoto(photo);
                  }}
                  className="card flex flex-col gap-1.5 p-2 text-left transition active:translate-y-0.5"
                >
                  <div className="relative aspect-[3/4] w-full overflow-hidden rounded-lg border-2 border-[var(--line)] bg-black">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/photos/${photo.id}?variant=thumb`}
                      alt={`${formatPhotoPoseLabel(photo.pose)} pose on ${photo.takenOn}`}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                    <span className="absolute left-1.5 top-1.5 rounded-md border border-[var(--line)] bg-[var(--card)]/90 px-1.5 py-0.5 text-[11px] font-bold text-[var(--ink)]">
                      {formatPhotoPoseLabel(photo.pose)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-1 px-0.5 text-xs">
                    <span className="font-bold text-[var(--ink)]">
                      {photo.takenOn}
                    </span>
                    <span className="text-[var(--muted)]">
                      {photo.weightKg !== null
                        ? `${kgToBodyDisplay(photo.weightKg, unit)} ${unit}`
                        : '—'}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* Capture / Upload Sheet */}
      <PhotoCaptureSheet
        open={captureOpen}
        onClose={() => setCaptureOpen(false)}
        defaultDate={data?.today ?? new Date().toISOString().slice(0, 10)}
        initialMode={captureInitialMode}
        existingPhotos={photos}
        onUploaded={load}
      />

      {/* Single Photo Viewer Sheet */}
      <Sheet
        open={selectedPhoto !== null}
        onClose={() => {
          if (!deleting) {
            setSelectedPhoto(null);
            setConfirmDelete(false);
          }
        }}
        title={
          selectedPhoto
            ? `${formatPhotoPoseLabel(selectedPhoto.pose)} · ${selectedPhoto.takenOn}`
            : undefined
        }
      >
        {selectedPhoto && (
          <div className="flex flex-col gap-3">
            <div className="mx-auto aspect-[3/4] w-full max-w-[320px] overflow-hidden rounded-xl border-2 border-[var(--line)] bg-black">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/photos/${selectedPhoto.id}`}
                alt={`${formatPhotoPoseLabel(selectedPhoto.pose)} pose on ${selectedPhoto.takenOn}`}
                className="h-full w-full object-cover"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-[var(--muted)]">
              <span>
                Weight:{' '}
                <strong className="text-[var(--ink)]">
                  {selectedPhoto.weightKg !== null
                    ? `${kgToBodyDisplay(selectedPhoto.weightKg, unit)} ${unit}`
                    : 'Not logged that day'}
                </strong>
              </span>
              <span>{Math.round(selectedPhoto.byteSize / 1024)} KB</span>
            </div>

            {confirmDelete ? (
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="alt"
                  disabled={deleting}
                  onClick={() => setConfirmDelete(false)}
                  className="min-h-[44px] flex-1"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="red"
                  loading={deleting}
                  onClick={() => void handleDeleteSelected()}
                  className="min-h-[44px] flex-1"
                >
                  Confirm Delete
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <a
                  href={`/api/photos/${selectedPhoto.id}?download=1`}
                  download
                  className="btn alt min-h-[44px] flex-1 justify-center gap-1.5 no-underline"
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                  Save Photo
                </a>
                <Button
                  type="button"
                  variant="red"
                  onClick={() => setConfirmDelete(true)}
                  className="min-h-[44px] gap-1.5 px-4"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  Delete
                </Button>
              </div>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}
