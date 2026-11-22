import { NextRequest, NextResponse } from 'next/server';
import { withApiHandler } from '@/lib/api/handler';
import { requireApiKeyAuth } from '@/lib/auth/session';
import {
  handleMcpJsonRpcRequest,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from '@/lib/mcp';

export const GET = withApiHandler('mcp.get', async (_req: NextRequest, ctx) => {
  return NextResponse.json(
    {
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: 'GET is not supported on this MCP endpoint; use POST',
      },
      requestId: ctx.requestId,
    },
    {
      status: 405,
      headers: { Allow: 'POST' },
    },
  );
});

export const POST = withApiHandler('mcp.post', async (req: NextRequest, ctx) => {
  const { user, apiKeyId, apiKeyPrefix } = await requireApiKeyAuth(req, ctx);
  const mcpCtx = {
    apiKeyId,
    apiKeyPrefix,
    origin: req.nextUrl.origin,
  };
  const securityHeaders = {
    'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer',
  };

  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return NextResponse.json(
      {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error: unable to read body' },
      },
      { status: 400, headers: securityHeaders },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody) as unknown;
  } catch {
    return NextResponse.json(
      {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error: invalid JSON' },
      },
      { status: 400, headers: securityHeaders },
    );
  }

  if (Array.isArray(parsed)) {
    if (parsed.length === 0) {
      return NextResponse.json(
        {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32600, message: 'Invalid Request: empty batch' },
        },
        { status: 400, headers: securityHeaders },
      );
    }

    const responses: JsonRpcResponse[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        responses.push({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32600, message: 'Invalid Request' },
        });
        continue;
      }
      const res = await handleMcpJsonRpcRequest(
        user,
        item as JsonRpcRequest,
        mcpCtx,
      );
      if (res !== null) {
        responses.push(res);
      }
    }

    if (responses.length === 0) {
      return new NextResponse(null, { status: 202, headers: securityHeaders });
    }
    return NextResponse.json(responses, { headers: securityHeaders });
  }

  if (!parsed || typeof parsed !== 'object') {
    return NextResponse.json(
      {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'Invalid Request: expected JSON-RPC object' },
      },
      { status: 400, headers: securityHeaders },
    );
  }

  const rpcResponse = await handleMcpJsonRpcRequest(
    user,
    parsed as JsonRpcRequest,
    mcpCtx,
  );
  if (rpcResponse === null) {
    return new NextResponse(null, { status: 202, headers: securityHeaders });
  }

  return NextResponse.json(rpcResponse, { headers: securityHeaders });
});
