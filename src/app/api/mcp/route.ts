import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/lib/auth/session';
import {
  handleMcpJsonRpcRequest,
  MCP_RESOURCES_DEFINITIONS,
  MCP_SERVER_INFO,
  MCP_TOOLS_DEFINITIONS,
  type JsonRpcRequest,
} from '@/lib/mcp/server';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, x-api-key, mcp-session-id',
};

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export async function GET(req: NextRequest) {
  const user = resolveUserFromRequest(req);
  return NextResponse.json(
    {
      ...MCP_SERVER_INFO,
      status: 'online',
      transport: 'streamable-http-jsonrpc',
      authenticatedUser: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        bodyweightKg: user.bodyweightKg,
        level: user.level,
        rankTier: user.rankTier,
      },
      tools: MCP_TOOLS_DEFINITIONS,
      resources: MCP_RESOURCES_DEFINITIONS,
    },
    { headers: CORS_HEADERS }
  );
}

export async function POST(req: NextRequest) {
  try {
    const user = resolveUserFromRequest(req);
    const body = await req.json();

    if (Array.isArray(body)) {
      const responses = body.map((item: JsonRpcRequest) =>
        handleMcpJsonRpcRequest(user, item)
      );
      return NextResponse.json(responses, { headers: CORS_HEADERS });
    }

    const response = handleMcpJsonRpcRequest(user, body as JsonRpcRequest);
    return NextResponse.json(response, { headers: CORS_HEADERS });
  } catch (err) {
    return NextResponse.json(
      {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message:
            err instanceof Error
              ? `Parse error: ${err.message}`
              : 'Invalid JSON-RPC request body',
        },
      },
      { status: 400, headers: CORS_HEADERS }
    );
  }
}
