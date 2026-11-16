import { NextRequest, NextResponse } from 'next/server';
import { withApiHandler } from '@/lib/api/handler';
import { generateApiKey, requireAuth } from '@/lib/auth/session';
import { upsertApiKey } from '@/lib/db/sessions';

export const POST = withApiHandler(
  'settings.apiKey.regenerate',
  async (req: NextRequest, ctx) => {
    const { user } = await requireAuth(req, ctx);
    const { rawKey, keyHash, keyPrefix } = generateApiKey();
    const apiKeyInfo = await upsertApiKey(user.id, keyHash, keyPrefix);

    const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin).replace(
      /\/+$/,
      '',
    );
    const mcpUrl = `${baseUrl}/api/mcp`;

    return NextResponse.json({
      apiKey: rawKey,
      keyPrefix,
      mcpUrl,
      apiKeyInfo,
    });
  },
);
