'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  FlipHorizontal2,
  Ghost,
  Grid3x3,
  ImagePlus,
  RotateCcw,
  Timer,
  Upload,
} from 'lucide-react';
import { Button, Sheet, toast } from '@/components/ui';
import {
  PHOTO_POSES,
  formatPhotoPoseLabel,
} from '@/lib/photos/constants';
import {
  captureVideoFrameToJpegPair,
  processImageFileToJpegPair,
  type ProcessedPhotoPair,
} from '@/lib/photos/clientImage';
import type { ProgressPhoto, ProgressPhotoPose } from '@/types/domain';

export interface PhotoCaptureSheetProps {
  open: boolean;
  onClose: () => void;
  defaultDate: string;
  initialMode: 'camera' | 'file';
  existingPhotos: ProgressPhoto[];
  onUploaded: () => Promise<void> | void;
}

type TimerSeconds = 0 | 3 | 10;

export function PhotoCaptureSheet({
  open,
  onClose,
  defaultDate,
  initialMode,
  existingPhotos,
  onUploaded,
}: PhotoCaptureSheetProps) {
  const [pose, setPose] = useState<ProgressPhotoPose>('front');
  const [takenOn, setTakenOn] = useState(defaultDate);
  const [mode, setMode] = useState<'camera' | 'file'>(initialMode);

  // Camera state
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);

  // Overlays & self-timer
  const [ghostEnabled, setGhostEnabled] = useState(true);
  const [ghostOpacity, setGhostOpacity] = useState(35);
  const [ghostPhotoId, setGhostPhotoId] = useState<string>('');
  const [gridEnabled, setGridEnabled] = useState(true);
  const [timerSeconds, setTimerSeconds] = useState<TimerSeconds>(0);
  const [countdownLeft, setCountdownLeft] = useState<number | null>(null);

  // Captured / picked pair waiting confirmation
  const [pendingPair, setPendingPair] = useState<ProcessedPhotoPair | null>(
    null,
  );
  const [pendingPreviewUrl, setPendingPreviewUrl] = useState<string | null>(
    null,
  );
  const [processing, setProcessing] = useState(false);
  const [uploading, setUploading] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const samePosePhotos = useMemo(
    () => existingPhotos.filter((p) => p.pose === pose),
    [existingPhotos, pose],
  );

  const activeGhostPhoto = useMemo(() => {
    if (samePosePhotos.length === 0) return null;
    return (
      samePosePhotos.find((p) => p.id === ghostPhotoId) ?? samePosePhotos[0]
    );
  }, [samePosePhotos, ghostPhotoId]);

  const stopCameraStream = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraReady(false);
  }, []);

  // Reset state when opened
  useEffect(() => {
    if (!open) {
      stopCameraStream();
      setCountdownLeft(null);
      if (pendingPreviewUrl) {
        URL.revokeObjectURL(pendingPreviewUrl);
      }
      setPendingPair(null);
      setPendingPreviewUrl(null);
      return;
    }
    setTakenOn(defaultDate);
    setMode(initialMode);
    setCameraError(null);
    setCountdownLeft(null);
    setPendingPair(null);
    setPendingPreviewUrl(null);
  }, [open, defaultDate, initialMode, stopCameraStream]);

  // Keep ghost photo matched to pose
  useEffect(() => {
    if (samePosePhotos.length === 0) {
      setGhostPhotoId('');
    } else if (!samePosePhotos.some((p) => p.id === ghostPhotoId)) {
      setGhostPhotoId(samePosePhotos[0].id);
    }
  }, [samePosePhotos, ghostPhotoId]);

  // Manage getUserMedia lifecycle
  useEffect(() => {
    if (!open || mode !== 'camera' || pendingPair !== null) {
      stopCameraStream();
      return;
    }

    let cancelled = false;
    setCameraError(null);
    setCameraReady(false);

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function'
    ) {
      setCameraError(
        'In-app camera is unavailable in this browser/context. Use file upload instead.',
      );
      return;
    }

    navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1920 },
          height: { ideal: 1440 },
        },
        audio: false,
      })
      .then((stream) => {
        if (cancelled) {
          for (const t of stream.getTracks()) t.stop();
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => {});
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg =
          err instanceof Error && err.name === 'NotAllowedError'
            ? 'Camera permission denied. Choose a photo from your library instead.'
            : 'Could not start camera. Choose a photo from your library instead.';
        setCameraError(msg);
      });

    return () => {
      cancelled = true;
      stopCameraStream();
    };
  }, [open, mode, facingMode, pendingPair, stopCameraStream]);

  // Clean up object URL on unmount/change
  useEffect(() => {
    return () => {
      if (pendingPreviewUrl) {
        URL.revokeObjectURL(pendingPreviewUrl);
      }
    };
  }, [pendingPreviewUrl]);

  const setConfirmedPair = useCallback(
    (pair: ProcessedPhotoPair) => {
      if (pendingPreviewUrl) {
        URL.revokeObjectURL(pendingPreviewUrl);
      }
      const previewUrl = URL.createObjectURL(pair.fullBlob);
      setPendingPair(pair);
      setPendingPreviewUrl(previewUrl);
    },
    [pendingPreviewUrl],
  );

  const captureNow = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !cameraReady) {
      toast.error('Camera feed is not ready yet');
      return;
    }
    setProcessing(true);
    try {
      const pair = await captureVideoFrameToJpegPair(video);
      setConfirmedPair(pair);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to capture photo',
      );
    } finally {
      setProcessing(false);
    }
  }, [cameraReady, setConfirmedPair]);

  // Self-timer countdown tick
  useEffect(() => {
    if (countdownLeft === null) return;
    if (countdownLeft <= 0) {
      setCountdownLeft(null);
      void captureNow();
      return;
    }
    const id = window.setTimeout(() => {
      setCountdownLeft((prev) => (prev !== null ? prev - 1 : null));
    }, 1000);
    return () => window.clearTimeout(id);
  }, [countdownLeft, captureNow]);

  function handleShutterClick() {
    if (countdownLeft !== null) {
      setCountdownLeft(null);
      return;
    }
    if (timerSeconds > 0) {
      setCountdownLeft(timerSeconds);
      return;
    }
    void captureNow();
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setProcessing(true);
    try {
      const pair = await processImageFileToJpegPair(file);
      setConfirmedPair(pair);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not process image',
      );
    } finally {
      setProcessing(false);
    }
  }

  function handleRetake() {
    if (pendingPreviewUrl) {
      URL.revokeObjectURL(pendingPreviewUrl);
    }
    setPendingPair(null);
    setPendingPreviewUrl(null);
  }

  async function handleUpload() {
    if (!pendingPair || uploading) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set('pose', pose);
      fd.set('takenOn', takenOn);
      fd.set('width', String(pendingPair.width));
      fd.set('height', String(pendingPair.height));
      fd.set('photo', pendingPair.fullBlob, `progress-${pose}.jpg`);
      fd.set('thumbnail', pendingPair.thumbBlob, `progress-${pose}-thumb.jpg`);

      const res = await fetch('/api/photos', {
        method: 'POST',
        credentials: 'same-origin',
        body: fd,
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(
          body?.error?.message || `Upload failed (${res.status})`,
        );
      }

      toast.success('Progress photo saved');
      await onUploaded();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Add Progress Photo">
      <div className="flex flex-col gap-3">
        {/* Pose & Date */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
              Pose
            </span>
            <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Pose">
              {PHOTO_POSES.map((p) => {
                const active = pose === p;
                return (
                  <button
                    key={p}
                    type="button"
                    disabled={uploading}
                    onClick={() => setPose(p)}
                    className={`min-h-[44px] rounded-xl border-2 border-[var(--line)] px-2 text-sm font-bold transition ${
                      active
                        ? 'bg-[var(--gold)] text-[var(--btn-gold-fg)] shadow-[2px_2px_0_var(--shadow-color)]'
                        : 'bg-[var(--surface)] text-[var(--muted)]'
                    }`}
                  >
                    {formatPhotoPoseLabel(p)}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
              Date
            </span>
            <input
              type="date"
              value={takenOn}
              disabled={uploading}
              onChange={(e) => setTakenOn(e.target.value)}
              className="min-h-[44px] w-full rounded-xl border-2 border-[var(--line)] bg-[var(--surface)] px-3 text-base"
            />
          </label>
        </div>

        {/* Mode toggle when not confirming */}
        {!pendingPair && (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMode('camera')}
              className={`flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border-2 border-[var(--line)] px-3 text-sm font-bold ${
                mode === 'camera'
                  ? 'bg-[var(--gold)] text-[var(--btn-gold-fg)]'
                  : 'bg-[var(--surface)] text-[var(--muted)]'
              }`}
            >
              <Camera className="h-4 w-4" aria-hidden="true" />
              Camera
            </button>
            <button
              type="button"
              onClick={() => setMode('file')}
              className={`flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border-2 border-[var(--line)] px-3 text-sm font-bold ${
                mode === 'file'
                  ? 'bg-[var(--gold)] text-[var(--btn-gold-fg)]'
                  : 'bg-[var(--surface)] text-[var(--muted)]'
              }`}
            >
              <Upload className="h-4 w-4" aria-hidden="true" />
              Library / File
            </button>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelected}
          className="sr-only"
          aria-label="Choose photo file"
        />

        {/* Confirm / Preview step */}
        {pendingPair && pendingPreviewUrl ? (
          <div className="flex flex-col gap-3">
            <div className="mx-auto w-full max-w-[300px] overflow-hidden rounded-xl border-2 border-[var(--line)] bg-black">
              <div className="relative aspect-[3/4] w-full">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={pendingPreviewUrl}
                  alt="Cropped 3:4 progress photo preview"
                  className="h-full w-full object-cover"
                />
              </div>
            </div>
            <p className="text-center text-xs text-[var(--muted)]">
              3:4 portrait · {pendingPair.width}×{pendingPair.height}px ·{' '}
              {Math.round(pendingPair.fullBlob.size / 1024)} KB (EXIF stripped)
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="alt"
                disabled={uploading}
                onClick={handleRetake}
                className="min-h-[44px] flex-1 gap-1.5"
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                Retake
              </Button>
              <Button
                type="button"
                loading={uploading}
                onClick={() => void handleUpload()}
                className="min-h-[44px] flex-1"
              >
                Save Photo
              </Button>
            </div>
          </div>
        ) : mode === 'file' || cameraError ? (
          /* File picker fallback (no overlay or grid) */
          <div className="card-sm flex flex-col items-center gap-3 bg-[var(--surface)] py-6 text-center">
            {cameraError && (
              <p className="text-sm text-[var(--red)]">{cameraError}</p>
            )}
            <ImagePlus
              className="h-10 w-10 text-[var(--muted)]"
              aria-hidden="true"
            />
            <p className="text-sm text-[var(--muted)]">
              Selected photos are automatically cropped to 3:4 portrait, resized,
              and stripped of EXIF location metadata on your device.
            </p>
            <Button
              type="button"
              loading={processing}
              onClick={() => fileInputRef.current?.click()}
              className="min-h-[44px] gap-2 px-5"
            >
              <Upload className="h-4 w-4" aria-hidden="true" />
              Choose Photo
            </Button>
          </div>
        ) : (
          /* Live Camera Viewport */
          <div className="flex flex-col gap-2.5">
            <div className="relative mx-auto aspect-[3/4] w-full max-w-[320px] overflow-hidden rounded-xl border-2 border-[var(--line)] bg-black">
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                onLoadedMetadata={() => setCameraReady(true)}
                onCanPlay={() => setCameraReady(true)}
                className={`h-full w-full object-cover ${
                  facingMode === 'user' ? '-scale-x-100' : ''
                }`}
              />

              {/* Ghost reference overlay */}
              {ghostEnabled && activeGhostPhoto && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={`/api/photos/${activeGhostPhoto.id}`}
                  alt=""
                  aria-hidden="true"
                  style={{ opacity: ghostOpacity / 100 }}
                  className={`pointer-events-none absolute inset-0 h-full w-full object-cover ${
                    facingMode === 'user' ? '-scale-x-100' : ''
                  }`}
                />
              )}

              {/* 3x3 Rule-of-thirds grid overlay */}
              {gridEnabled && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0"
                >
                  <div className="absolute inset-y-0 left-1/3 w-px bg-white/45" />
                  <div className="absolute inset-y-0 left-2/3 w-px bg-white/45" />
                  <div className="absolute inset-x-0 top-1/3 h-px bg-white/45" />
                  <div className="absolute inset-x-0 top-2/3 h-px bg-white/45" />
                </div>
              )}

              {/* Countdown overlay */}
              {countdownLeft !== null && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/30">
                  <span className="font-marker text-6xl text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.8)]">
                    {countdownLeft}
                  </span>
                </div>
              )}

              {!cameraReady && (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-white/80">
                  Starting camera…
                </div>
              )}
            </div>

            {/* Camera Controls */}
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={() =>
                  setFacingMode((m) => (m === 'user' ? 'environment' : 'user'))
                }
                aria-label="Flip camera"
                className="flex min-h-[44px] items-center gap-1.5 rounded-xl border-2 border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-bold text-[var(--ink)]"
              >
                <FlipHorizontal2 className="h-4 w-4" aria-hidden="true" />
                Flip
              </button>

              <button
                type="button"
                onClick={() => setGridEnabled((v) => !v)}
                aria-pressed={gridEnabled}
                className={`flex min-h-[44px] items-center gap-1.5 rounded-xl border-2 border-[var(--line)] px-3 text-sm font-bold ${
                  gridEnabled
                    ? 'bg-[var(--gold)] text-[var(--btn-gold-fg)]'
                    : 'bg-[var(--surface)] text-[var(--muted)]'
                }`}
              >
                <Grid3x3 className="h-4 w-4" aria-hidden="true" />
                Grid
              </button>

              <button
                type="button"
                onClick={() => setGhostEnabled((v) => !v)}
                aria-pressed={ghostEnabled}
                disabled={samePosePhotos.length === 0}
                className={`flex min-h-[44px] items-center gap-1.5 rounded-xl border-2 border-[var(--line)] px-3 text-sm font-bold disabled:opacity-50 ${
                  ghostEnabled && samePosePhotos.length > 0
                    ? 'bg-[var(--gold)] text-[var(--btn-gold-fg)]'
                    : 'bg-[var(--surface)] text-[var(--muted)]'
                }`}
              >
                <Ghost className="h-4 w-4" aria-hidden="true" />
                Ghost
              </button>

              <button
                type="button"
                onClick={() =>
                  setTimerSeconds((prev) =>
                    prev === 0 ? 3 : prev === 3 ? 10 : 0,
                  )
                }
                className={`flex min-h-[44px] items-center gap-1.5 rounded-xl border-2 border-[var(--line)] px-3 text-sm font-bold ${
                  timerSeconds > 0
                    ? 'bg-[var(--gold)] text-[var(--btn-gold-fg)]'
                    : 'bg-[var(--surface)] text-[var(--muted)]'
                }`}
              >
                <Timer className="h-4 w-4" aria-hidden="true" />
                {timerSeconds === 0 ? 'Timer Off' : `${timerSeconds}s`}
              </button>
            </div>

            {/* Ghost opacity & reference selector */}
            {ghostEnabled && samePosePhotos.length > 0 && (
              <div className="flex flex-col gap-2 rounded-xl border-2 border-[var(--line)]/40 bg-[var(--surface)] p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-[var(--muted)]">
                    Ghost opacity: {ghostOpacity}%
                  </span>
                  {samePosePhotos.length > 1 && (
                    <select
                      aria-label="Ghost reference photo"
                      value={activeGhostPhoto?.id ?? ''}
                      onChange={(e) => setGhostPhotoId(e.target.value)}
                      className="min-h-[36px] rounded-lg border border-[var(--line)] bg-[var(--card)] px-2 text-xs font-bold text-[var(--ink)]"
                    >
                      {samePosePhotos.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.takenOn}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <input
                  type="range"
                  min={10}
                  max={80}
                  value={ghostOpacity}
                  onChange={(e) => setGhostOpacity(Number(e.target.value))}
                  aria-label="Ghost overlay opacity"
                  className="h-6 w-full accent-[var(--gold)]"
                />
              </div>
            )}

            <div className="flex gap-2">
              <Button
                type="button"
                variant="alt"
                disabled={processing}
                onClick={() => fileInputRef.current?.click()}
                className="min-h-[48px] px-3"
              >
                <ImagePlus className="h-5 w-5" aria-hidden="true" />
              </Button>
              <Button
                type="button"
                loading={processing}
                disabled={!cameraReady}
                onClick={handleShutterClick}
                className="min-h-[48px] flex-1 gap-2 text-base"
              >
                <Camera className="h-5 w-5" aria-hidden="true" />
                {countdownLeft !== null
                  ? `Cancel (${countdownLeft}s)`
                  : timerSeconds > 0
                    ? `Start ${timerSeconds}s Timer`
                    : 'Capture'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}
