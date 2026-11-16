import { NextRequest, NextResponse } from 'next/server';
import { ApiError, parseJsonBody, withApiHandler } from '@/lib/api/handler';
import { safeRecordEvent } from '@/lib/admin/events';
import { requireAuth } from '@/lib/auth/session';
import {
  applyAiImport,
  getAiPromptContext,
  validateImportForUser,
} from '@/lib/ai';

interface ImportBody {
  mode?: unknown;
  rawText?: unknown;
}

export const GET = withApiHandler('ai.import.context', async (req: NextRequest, ctx) => {
  const { user } = await requireAuth(req, ctx);
  const context = await getAiPromptContext(user);
  return NextResponse.json(context);
});

export const POST = withApiHandler('ai.import', async (req: NextRequest, ctx) => {
  const { user } = await requireAuth(req, ctx);
  const body = await parseJsonBody<ImportBody>(req);

  if (body.mode !== 'validate' && body.mode !== 'confirm') {
    throw ApiError.validation('mode must be "validate" or "confirm"');
  }

  if (typeof body.rawText !== 'string') {
    throw ApiError.validation('rawText must be a string');
  }

  if (body.mode === 'validate') {
    const result = await validateImportForUser(user, body.rawText);
    return NextResponse.json(result);
  }

  const result = await applyAiImport(user, body.rawText);
  if (!result.valid) {
    throw ApiError.validation('Invalid AI plan JSON', { errors: result.errors });
  }

  await safeRecordEvent({
    userId: user.id,
    eventType: 'ai_import',
    detail: {
      dayCount: result.schedule?.days.length ?? 0,
      customExerciseCount: result.createdCustomExercises?.length ?? 0,
    },
  });

  return NextResponse.json(result);
});
