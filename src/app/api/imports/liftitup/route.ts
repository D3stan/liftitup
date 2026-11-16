import { NextRequest, NextResponse } from 'next/server';
import { ApiError, withApiHandler } from '@/lib/api/handler';
import { safeRecordEvent } from '@/lib/admin/events';
import { requireAuth } from '@/lib/auth/session';
import {
  applyLiftitupRestore,
  MAX_IMPORT_BYTES,
  validateLiftitupRestore,
  type RestoreMode,
  type UnmatchedExerciseResolution,
} from '@/lib/imports/liftitupRestore';

interface LiftitupRouteBody {
  action?: unknown;
  mode?: unknown;
  rawText?: unknown;
  confirmation?: unknown;
  exerciseResolutions?: unknown;
}

function parseContentLength(req: NextRequest): number | null {
  const raw = req.headers.get('content-length');
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseMode(rawMode: unknown): RestoreMode {
  if (rawMode === undefined || rawMode === null || rawMode === '') {
    return 'merge';
  }
  if (rawMode === 'merge' || rawMode === 'replace') {
    return rawMode;
  }
  throw ApiError.validation('mode must be "merge" or "replace"');
}

function parseExerciseResolutions(
  raw: unknown,
): Record<string, UnmatchedExerciseResolution> | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw ApiError.validation('exerciseResolutions must be an object');
  }
  return raw as Record<string, UnmatchedExerciseResolution>;
}

async function extractRequestPayload(
  req: NextRequest,
): Promise<LiftitupRouteBody> {
  const contentType = (req.headers.get('content-type') ?? '').toLowerCase();
  const contentLength = parseContentLength(req);

  if (contentType.includes('multipart/form-data')) {
    if (contentLength !== null && contentLength > MAX_IMPORT_BYTES + 128 * 1024) {
      throw ApiError.validation('Import file exceeds 8 MB limit');
    }
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      throw ApiError.badRequest('Invalid multipart form data');
    }

    const fileEntry = formData.get('file');
    let rawText: unknown = formData.get('rawText');
    if (fileEntry && typeof fileEntry === 'object' && 'text' in fileEntry) {
      const file = fileEntry as File;
      if (file.size > MAX_IMPORT_BYTES) {
        throw ApiError.validation('Import file exceeds 8 MB limit');
      }
      rawText = await file.text();
    }

    const rawRes = formData.get('exerciseResolutions');
    let exerciseResolutions: unknown = undefined;
    if (typeof rawRes === 'string' && rawRes.trim()) {
      try {
        exerciseResolutions = JSON.parse(rawRes) as unknown;
      } catch {
        throw ApiError.validation('exerciseResolutions must be valid JSON');
      }
    }

    return {
      action: formData.get('action'),
      mode: formData.get('mode'),
      rawText,
      confirmation: formData.get('confirmation'),
      exerciseResolutions,
    };
  }

  if (contentLength !== null && contentLength > MAX_IMPORT_BYTES) {
    throw ApiError.validation('Import payload exceeds 8 MB limit');
  }

  let buf: ArrayBuffer;
  try {
    buf = await req.arrayBuffer();
  } catch {
    throw ApiError.badRequest('Failed to read request body');
  }

  if (buf.byteLength > MAX_IMPORT_BYTES) {
    throw ApiError.validation('Import payload exceeds 8 MB limit');
  }

  const bodyText = Buffer.from(buf).toString('utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText) as unknown;
  } catch {
    throw ApiError.badRequest('Invalid JSON request body');
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw ApiError.badRequest('Request body must be a JSON object');
  }

  return parsed as LiftitupRouteBody;
}

export const POST = withApiHandler(
  'imports.liftitup.post',
  async (req: NextRequest, ctx) => {
    const { user } = await requireAuth(req, ctx);
    const body = await extractRequestPayload(req);

    if (body.action !== 'validate' && body.action !== 'confirm') {
      throw ApiError.validation('action must be "validate" or "confirm"');
    }

    if (typeof body.rawText !== 'string') {
      throw ApiError.validation('rawText must be a string');
    }

    const mode = parseMode(body.mode);

    if (body.action === 'validate') {
      const result = await validateLiftitupRestore(user, body.rawText, { mode });
      if (!result.valid) {
        throw ApiError.validation(
          result.errors[0]?.message ?? 'Invalid Liftitup export JSON',
          { errors: result.errors },
        );
      }
      return NextResponse.json(result);
    }

    const confirmation =
      typeof body.confirmation === 'string' ? body.confirmation : undefined;
    const exerciseResolutions = parseExerciseResolutions(
      body.exerciseResolutions,
    );

    const result = await applyLiftitupRestore(user, body.rawText, {
      mode,
      confirmation,
      exerciseResolutions,
    });
    await safeRecordEvent({
      userId: user.id,
      eventType: 'file_import',
      detail: { source: 'liftitup', mode },
    });
    return NextResponse.json(result);
  },
);
