import { Readable } from 'node:stream';
import yazl from 'yazl';
import { kgToBodyDisplay } from '@/lib/body/weight';
import type { ProgressPhoto, UserProfile } from '@/types/domain';

export interface PhotoArchiveEntry {
  photo: ProgressPhoto;
  filename: string;
}

export interface PhotoArchiveIndexItem {
  filename: string;
  id: string;
  date: string;
  pose: ProgressPhoto['pose'];
  weightKg: number | null;
  weightDisplay: number | null;
  unit: UserProfile['unit'];
  byteSize: number;
  createdAt: string;
}

/**
 * Assigns deterministic, unique archive paths ordered chronologically by
 * `takenOn ASC, createdAt ASC, id ASC`. Multiple photos on the same date+pose
 * receive `-2`, `-3`, ... suffixes.
 */
export function buildPhotoArchiveManifest(
  photos: ProgressPhoto[],
  unit: UserProfile['unit'],
): {
  entries: PhotoArchiveEntry[];
  indexItems: PhotoArchiveIndexItem[];
} {
  const sorted = [...photos].sort((a, b) => {
    const d = a.takenOn.localeCompare(b.takenOn);
    if (d !== 0) return d;
    const c = a.createdAt.localeCompare(b.createdAt);
    if (c !== 0) return c;
    return a.id.localeCompare(b.id);
  });

  const counts = new Map<string, number>();
  const entries: PhotoArchiveEntry[] = [];
  const indexItems: PhotoArchiveIndexItem[] = [];

  for (const photo of sorted) {
    const key = `${photo.takenOn}-${photo.pose}`;
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    const suffix = n === 1 ? '' : `-${n}`;
    const filename = `photos/${photo.takenOn}-${photo.pose}${suffix}.jpg`;

    entries.push({ photo, filename });
    indexItems.push({
      filename,
      id: photo.id,
      date: photo.takenOn,
      pose: photo.pose,
      weightKg: photo.weightKg,
      weightDisplay:
        photo.weightKg === null ? null : kgToBodyDisplay(photo.weightKg, unit),
      unit,
      byteSize: photo.byteSize,
      createdAt: photo.createdAt,
    });
  }

  return { entries, indexItems };
}

function csvEscape(val: string): string {
  if (/[",\n\r]/.test(val)) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

export function buildPhotoArchiveIndexCsv(
  items: PhotoArchiveIndexItem[],
): string {
  const header = 'filename,date,pose,weight_kg,weight_display,unit,created_at';
  const rows = items.map((item) =>
    [
      csvEscape(item.filename),
      csvEscape(item.date),
      csvEscape(item.pose),
      item.weightKg === null ? '' : String(item.weightKg),
      item.weightDisplay === null ? '' : String(item.weightDisplay),
      csvEscape(item.unit),
      csvEscape(item.createdAt),
    ].join(','),
  );
  return [header, ...rows].join('\n') + '\n';
}

/**
 * Streams a ZIP archive containing `index.json`, `index.csv`, and each photo JPEG
 * fetched lazily one-by-one from Postgres so memory stays bounded regardless of library size.
 */
export function createPhotoArchiveStream(
  user: Pick<UserProfile, 'username' | 'unit'>,
  photos: ProgressPhoto[],
  fetchPhotoBytes: (photoId: string) => Promise<Buffer | null>,
): ReadableStream<Uint8Array> {
  const { entries, indexItems } = buildPhotoArchiveManifest(photos, user.unit);
  const zipfile = new yazl.ZipFile();

  const indexJson = JSON.stringify(
    {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      username: user.username,
      unit: user.unit,
      count: indexItems.length,
      photos: indexItems,
    },
    null,
    2,
  );
  const indexCsv = buildPhotoArchiveIndexCsv(indexItems);

  zipfile.addBuffer(Buffer.from(indexJson, 'utf8'), 'index.json');
  zipfile.addBuffer(Buffer.from(indexCsv, 'utf8'), 'index.csv');

  for (const entry of entries) {
    const mtime = Number.isFinite(Date.parse(entry.photo.createdAt))
      ? new Date(entry.photo.createdAt)
      : new Date();

    zipfile.addReadStreamLazy(
      entry.filename,
      { compress: false, mtime },
      (cb) => {
        fetchPhotoBytes(entry.photo.id)
          .then((bytes) => {
            if (!bytes) {
              cb(
                new Error(`Missing binary payload for photo ${entry.photo.id}`),
                null as unknown as NodeJS.ReadableStream,
              );
              return;
            }
            cb(null, Readable.from([bytes]));
          })
          .catch((err) => {
            cb(err, null as unknown as NodeJS.ReadableStream);
          });
      },
    );
  }

  zipfile.end();
  return Readable.toWeb(
    zipfile.outputStream as unknown as Readable,
  ) as unknown as ReadableStream<Uint8Array>;
}
