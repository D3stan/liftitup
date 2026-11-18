'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Columns2, MoveHorizontal } from 'lucide-react';
import { kgToBodyDisplay } from '@/lib/body/weight';
import { PHOTO_POSES, formatPhotoPoseLabel } from '@/lib/photos/constants';
import type {
  ProgressPhoto,
  ProgressPhotoPose,
  WeightUnit,
} from '@/types/domain';

export interface PhotoCompareViewProps {
  photos: ProgressPhoto[];
  unit: WeightUnit;
}

function formatPhotoMeta(photo: ProgressPhoto, unit: WeightUnit): string {
  if (photo.weightKg === null) return photo.takenOn;
  return `${photo.takenOn} · ${kgToBodyDisplay(photo.weightKg, unit)} ${unit}`;
}

export function PhotoCompareView({ photos, unit }: PhotoCompareViewProps) {
  const availablePoses = useMemo(() => {
    return PHOTO_POSES.filter(
      (pose) => photos.filter((p) => p.pose === pose).length >= 2,
    );
  }, [photos]);

  const [selectedPose, setSelectedPose] = useState<ProgressPhotoPose>(
    availablePoses[0] ?? 'front',
  );
  const [compareMode, setCompareMode] = useState<'slider' | 'side-by-side'>(
    'slider',
  );
  const [sliderPct, setSliderPct] = useState(50);

  const posePhotos = useMemo(() => {
    return photos
      .filter((p) => p.pose === selectedPose)
      .sort((a, b) => {
        const d = a.takenOn.localeCompare(b.takenOn);
        if (d !== 0) return d;
        return a.createdAt.localeCompare(b.createdAt);
      });
  }, [photos, selectedPose]);

  const [beforeId, setBeforeId] = useState<string>('');
  const [afterId, setAfterId] = useState<string>('');

  const frameRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    if (
      availablePoses.length > 0 &&
      !availablePoses.includes(selectedPose)
    ) {
      setSelectedPose(availablePoses[0]);
    }
  }, [availablePoses, selectedPose]);

  useEffect(() => {
    if (posePhotos.length < 2) {
      setBeforeId('');
      setAfterId('');
      return;
    }
    const validBefore = posePhotos.some((p) => p.id === beforeId);
    const validAfter = posePhotos.some((p) => p.id === afterId);
    if (!validBefore) {
      setBeforeId(posePhotos[0].id);
    }
    if (!validAfter) {
      setAfterId(posePhotos[posePhotos.length - 1].id);
    }
  }, [posePhotos, beforeId, afterId]);

  const beforePhoto = useMemo(
    () => posePhotos.find((p) => p.id === beforeId) ?? posePhotos[0] ?? null,
    [posePhotos, beforeId],
  );
  const afterPhoto = useMemo(
    () =>
      posePhotos.find((p) => p.id === afterId) ??
      posePhotos[posePhotos.length - 1] ??
      null,
    [posePhotos, afterId],
  );

  function updateSliderFromPointer(clientX: number) {
    const el = frameRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setSliderPct(Math.max(0, Math.min(100, Math.round(pct))));
  }

  if (availablePoses.length === 0) {
    return (
      <div className="card py-8 text-center">
        <p className="font-marker text-lg text-[var(--ink)]">
          Need 2 photos of the same pose
        </p>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Add at least two Front, two Side, or two Back photos to compare dates.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Pose + Mode Switch */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5" role="group" aria-label="Compare pose">
          {availablePoses.map((pose) => (
            <button
              key={pose}
              type="button"
              onClick={() => setSelectedPose(pose)}
              className={`min-h-[44px] rounded-xl border-2 border-[var(--line)] px-3 text-sm font-bold ${
                selectedPose === pose
                  ? 'bg-[var(--gold)] text-[var(--btn-gold-fg)] shadow-[2px_2px_0_var(--shadow-color)]'
                  : 'bg-[var(--card)] text-[var(--muted)]'
              }`}
            >
              {formatPhotoPoseLabel(pose)}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5" role="group" aria-label="Compare mode">
          <button
            type="button"
            onClick={() => setCompareMode('slider')}
            className={`flex min-h-[44px] items-center gap-1.5 rounded-xl border-2 border-[var(--line)] px-3 text-sm font-bold ${
              compareMode === 'slider'
                ? 'bg-[var(--gold)] text-[var(--btn-gold-fg)]'
                : 'bg-[var(--card)] text-[var(--muted)]'
            }`}
          >
            <MoveHorizontal className="h-4 w-4" aria-hidden="true" />
            Slider
          </button>
          <button
            type="button"
            onClick={() => setCompareMode('side-by-side')}
            className={`flex min-h-[44px] items-center gap-1.5 rounded-xl border-2 border-[var(--line)] px-3 text-sm font-bold ${
              compareMode === 'side-by-side'
                ? 'bg-[var(--gold)] text-[var(--btn-gold-fg)]'
                : 'bg-[var(--card)] text-[var(--muted)]'
            }`}
          >
            <Columns2 className="h-4 w-4" aria-hidden="true" />
            Side-by-side
          </button>
        </div>
      </div>

      {/* Photo A / B pickers */}
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
            Left / Before
          </span>
          <select
            value={beforePhoto?.id ?? ''}
            onChange={(e) => setBeforeId(e.target.value)}
            className="min-h-[44px] w-full rounded-xl border-2 border-[var(--line)] bg-[var(--surface)] px-2.5 text-sm font-bold text-[var(--ink)]"
          >
            {posePhotos.map((p) => (
              <option key={p.id} value={p.id}>
                {formatPhotoMeta(p, unit)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
            Right / After
          </span>
          <select
            value={afterPhoto?.id ?? ''}
            onChange={(e) => setAfterId(e.target.value)}
            className="min-h-[44px] w-full rounded-xl border-2 border-[var(--line)] bg-[var(--surface)] px-2.5 text-sm font-bold text-[var(--ink)]"
          >
            {posePhotos.map((p) => (
              <option key={p.id} value={p.id}>
                {formatPhotoMeta(p, unit)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {beforePhoto && afterPhoto && compareMode === 'slider' && (
        <div className="card flex flex-col gap-2.5">
          <div
            ref={frameRef}
            onPointerDown={(e) => {
              draggingRef.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              updateSliderFromPointer(e.clientX);
            }}
            onPointerMove={(e) => {
              if (!draggingRef.current) return;
              updateSliderFromPointer(e.clientX);
            }}
            onPointerUp={() => {
              draggingRef.current = false;
            }}
            onPointerCancel={() => {
              draggingRef.current = false;
            }}
            className="relative mx-auto aspect-[3/4] w-full max-w-[360px] cursor-ew-resize touch-none select-none overflow-hidden rounded-xl border-2 border-[var(--line)] bg-black"
          >
            {/* After photo (right side base) */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/photos/${afterPhoto.id}`}
              alt={`After ${afterPhoto.takenOn}`}
              draggable={false}
              className="pointer-events-none absolute inset-0 h-full w-full object-cover"
            />

            {/* Before photo (left side clipped) */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/photos/${beforePhoto.id}`}
              alt={`Before ${beforePhoto.takenOn}`}
              draggable={false}
              style={{ clipPath: `inset(0 ${100 - sliderPct}% 0 0)` }}
              className="pointer-events-none absolute inset-0 h-full w-full object-cover"
            />

            {/* Labels */}
            <div className="pointer-events-none absolute left-2 top-2 rounded-lg border border-[var(--line)] bg-[var(--card)]/90 px-2 py-1 text-xs font-bold text-[var(--ink)]">
              {formatPhotoMeta(beforePhoto, unit)}
            </div>
            <div className="pointer-events-none absolute right-2 top-2 rounded-lg border border-[var(--line)] bg-[var(--card)]/90 px-2 py-1 text-xs font-bold text-[var(--ink)]">
              {formatPhotoMeta(afterPhoto, unit)}
            </div>

            {/* Vertical divider + 44px drag handle */}
            <div
              style={{ left: `${sliderPct}%` }}
              className="pointer-events-none absolute inset-y-0 -translate-x-1/2"
            >
              <div className="mx-auto h-full w-0.5 bg-white shadow-[0_0_4px_rgba(0,0,0,0.9)]" />
              <div className="absolute left-1/2 top-1/2 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-[var(--line)] bg-[var(--gold)] text-[var(--btn-gold-fg)] shadow-[2px_2px_0_var(--shadow-color)]">
                <MoveHorizontal className="h-5 w-5" aria-hidden="true" />
              </div>
            </div>
          </div>

          <input
            type="range"
            min={0}
            max={100}
            value={sliderPct}
            onChange={(e) => setSliderPct(Number(e.target.value))}
            aria-label="Compare slider position"
            className="mx-auto h-8 w-full max-w-[360px] accent-[var(--gold)]"
          />
        </div>
      )}

      {beforePhoto && afterPhoto && compareMode === 'side-by-side' && (
        <div className="grid grid-cols-2 gap-2">
          {[beforePhoto, afterPhoto].map((item, idx) => (
            <div key={`${item.id}-${idx}`} className="card flex flex-col gap-1.5 p-2">
              <div className="relative aspect-[3/4] w-full overflow-hidden rounded-lg border-2 border-[var(--line)] bg-black">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/photos/${item.id}`}
                  alt={`${idx === 0 ? 'Before' : 'After'} ${item.takenOn}`}
                  className="h-full w-full object-cover"
                />
              </div>
              <p className="text-center text-xs font-bold text-[var(--ink)]">
                {item.takenOn}
              </p>
              <p className="text-center text-xs text-[var(--muted)]">
                {item.weightKg !== null
                  ? `${kgToBodyDisplay(item.weightKg, unit)} ${unit}`
                  : 'No weight'}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
