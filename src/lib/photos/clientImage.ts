import {
  MAX_PHOTO_BYTES,
  MAX_THUMB_BYTES,
  PHOTO_ASPECT_RATIO,
  PHOTO_TARGET_LONG_EDGE_PX,
  PHOTO_THUMB_LONG_EDGE_PX,
} from './constants';

export interface PortraitCropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export interface OutputDimensions {
  width: number;
  height: number;
}

export interface ProcessedPhotoPair {
  fullBlob: Blob;
  thumbBlob: Blob;
  width: number;
  height: number;
}

/**
 * Computes a centered 3:4 portrait crop rectangle within a source image/video frame.
 */
export function computePortrait3x4CropRect(
  srcWidth: number,
  srcHeight: number,
): PortraitCropRect {
  if (
    !Number.isFinite(srcWidth) ||
    !Number.isFinite(srcHeight) ||
    srcWidth <= 0 ||
    srcHeight <= 0
  ) {
    throw new Error('Source dimensions must be positive numbers');
  }

  const w = Math.floor(srcWidth);
  const h = Math.floor(srcHeight);
  const srcRatio = w / h;

  if (srcRatio > PHOTO_ASPECT_RATIO) {
    // Source is wider than 3:4 — crop horizontally
    const sh = h;
    const sw = Math.max(1, Math.min(w, Math.round(h * PHOTO_ASPECT_RATIO)));
    const sx = Math.floor((w - sw) / 2);
    return { sx, sy: 0, sw, sh };
  }

  // Source is taller than or equal to 3:4 — crop vertically
  const sw = w;
  const sh = Math.max(1, Math.min(h, Math.round(w / PHOTO_ASPECT_RATIO)));
  const sy = Math.floor((h - sh) / 2);
  return { sx: 0, sy, sw, sh };
}

/**
 * Computes resized output dimensions capped by `maxLongEdge`, without upscaling.
 */
export function computeOutputDimensions(
  cropWidth: number,
  cropHeight: number,
  maxLongEdge: number,
): OutputDimensions {
  const longEdge = Math.max(cropWidth, cropHeight);
  if (longEdge <= maxLongEdge) {
    return { width: Math.round(cropWidth), height: Math.round(cropHeight) };
  }
  const scale = maxLongEdge / longEdge;
  return {
    width: Math.max(1, Math.round(cropWidth * scale)),
    height: Math.max(1, Math.round(cropHeight * scale)),
  };
}

function canvasToJpegBlob(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Failed to encode JPEG image'));
          return;
        }
        resolve(blob);
      },
      'image/jpeg',
      quality,
    );
  });
}

async function renderCroppedJpegPair(
  source: CanvasImageSource,
  srcWidth: number,
  srcHeight: number,
): Promise<ProcessedPhotoPair> {
  const crop = computePortrait3x4CropRect(srcWidth, srcHeight);
  const fullDims = computeOutputDimensions(
    crop.sw,
    crop.sh,
    PHOTO_TARGET_LONG_EDGE_PX,
  );
  const thumbDims = computeOutputDimensions(
    crop.sw,
    crop.sh,
    PHOTO_THUMB_LONG_EDGE_PX,
  );

  const fullCanvas = document.createElement('canvas');
  fullCanvas.width = fullDims.width;
  fullCanvas.height = fullDims.height;
  const fullCtx = fullCanvas.getContext('2d');
  if (!fullCtx) {
    throw new Error('Canvas 2D context unavailable');
  }
  fullCtx.imageSmoothingEnabled = true;
  fullCtx.imageSmoothingQuality = 'high';
  fullCtx.drawImage(
    source,
    crop.sx,
    crop.sy,
    crop.sw,
    crop.sh,
    0,
    0,
    fullDims.width,
    fullDims.height,
  );

  // Re-encoding via canvas strips EXIF/GPS metadata and keeps size well under 1 MB.
  let fullBlob: Blob | null = null;
  for (const quality of [0.85, 0.76, 0.65, 0.52]) {
    const candidate = await canvasToJpegBlob(fullCanvas, quality);
    fullBlob = candidate;
    if (candidate.size <= Math.min(950 * 1024, MAX_PHOTO_BYTES)) {
      break;
    }
  }
  if (!fullBlob || fullBlob.size > MAX_PHOTO_BYTES) {
    throw new Error('Processed photo exceeds the 2 MB limit');
  }

  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width = thumbDims.width;
  thumbCanvas.height = thumbDims.height;
  const thumbCtx = thumbCanvas.getContext('2d');
  if (!thumbCtx) {
    throw new Error('Canvas 2D context unavailable');
  }
  thumbCtx.imageSmoothingEnabled = true;
  thumbCtx.imageSmoothingQuality = 'high';
  thumbCtx.drawImage(
    fullCanvas,
    0,
    0,
    fullDims.width,
    fullDims.height,
    0,
    0,
    thumbDims.width,
    thumbDims.height,
  );

  let thumbBlob = await canvasToJpegBlob(thumbCanvas, 0.78);
  if (thumbBlob.size > MAX_THUMB_BYTES) {
    thumbBlob = await canvasToJpegBlob(thumbCanvas, 0.6);
  }
  if (thumbBlob.size > MAX_THUMB_BYTES) {
    throw new Error('Processed thumbnail exceeds maximum size');
  }

  return {
    fullBlob,
    thumbBlob,
    width: fullDims.width,
    height: fullDims.height,
  };
}

/**
 * Loads an image File/Blob (honoring browser EXIF orientation), center-crops to 3:4,
 * resizes to <= 2000px long edge, re-encodes as EXIF-free JPEG, and creates a ~300px thumbnail.
 */
export async function processImageFileToJpegPair(
  file: Blob,
): Promise<ProcessedPhotoPair> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    try {
      return await renderCroppedJpegPair(bitmap, bitmap.width, bitmap.height);
    } finally {
      bitmap.close();
    }
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Could not decode selected image'));
      el.src = objectUrl;
    });
    return await renderCroppedJpegPair(img, img.naturalWidth, img.naturalHeight);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Captures the current unmirrored frame from a live <video> element,
 * center-crops to 3:4, resizes to <= 2000px, and generates a ~300px thumbnail.
 */
export async function captureVideoFrameToJpegPair(
  video: HTMLVideoElement,
): Promise<ProcessedPhotoPair> {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) {
    throw new Error('Camera feed is not ready yet');
  }
  return renderCroppedJpegPair(video, vw, vh);
}
