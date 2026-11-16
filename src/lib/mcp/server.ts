import type { UserProfile } from '@/types/domain';
import { isAdminUser } from '@/lib/admin/auth';
import { getApiKeyByUserId } from '@/lib/db/sessions';
import { getUserById } from '@/lib/db/users';
import { ADMIN_MCP_TOOLS_DEFINITIONS, executeAdminToolCall } from './adminTools';
import {
  ALL_USER_MCP_TOOLS_DEFINITIONS,
  executeUserToolCall,
  ORIGINAL_USER_TOOLS_DEFINITIONS,
} from './userTools';
import {
  wrapToolResult,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type McpExecutionContext,
  type McpToolDefinition,
  type ResolvedMcpCaller,
} from './types';

const SUPPORTED_PROTOCOL_VERSIONS = ['2025-03-26', '2024-11-05'] as const;

export const MCP_SERVER_INFO = {
  name: 'liftitup-mcp',
  version: '2.1.0',
  protocolVersion: '2025-03-26',
};

export const MCP_TOOLS_DEFINITIONS: readonly McpToolDefinition[] =
  ALL_USER_MCP_TOOLS_DEFINITIONS;

export {
  ADMIN_MCP_TOOLS_DEFINITIONS,
  ALL_USER_MCP_TOOLS_DEFINITIONS,
  ORIGINAL_USER_TOOLS_DEFINITIONS,
};

/**
 * Dynamically computes the visible tool list for `user`:
 * - Guest users: only the original 9 tools.
 * - Registered non-admin users: all Part A user tools.
 * - Dynamically verified admins (`ADMIN_USER_IDS`, non-guest, non-disabled): Part A + Part B admin tools.
 */
export function getMcpToolsForUser(user: UserProfile): McpToolDefinition[] {
  if (user.isDisabled) {
    return [];
  }
  if (user.isGuest) {
    return [...ORIGINAL_USER_TOOLS_DEFINITIONS];
  }
  if (isAdminUser(user)) {
    return [...ALL_USER_MCP_TOOLS_DEFINITIONS, ...ADMIN_MCP_TOOLS_DEFINITIONS];
  }
  return [...ALL_USER_MCP_TOOLS_DEFINITIONS];
}

async function resolveCallerContext(
  user: UserProfile,
  context?: McpExecutionContext,
): Promise<ResolvedMcpCaller> {
  if (context?.apiKeyId) {
    return {
      user,
      apiKeyId: context.apiKeyId,
      apiKeyPrefix: context.apiKeyPrefix || 'liuk',
      origin: context.origin ?? null,
    };
  }
  const activeKey = await getApiKeyByUserId(user.id);
  return {
    user,
    apiKeyId: activeKey?.id ?? `direct:${user.id}`,
    apiKeyPrefix: activeKey?.keyPrefix ?? 'direct',
    origin: context?.origin ?? null,
  };
}

/**
 * Executes a single JSON-RPC 2.0 MCP request strictly scoped to `user`.
 * Returns `null` when the message is a JSON-RPC notification (no `id`).
 */
export async function handleMcpJsonRpcRequest(
  user: UserProfile,
  rpc: JsonRpcRequest,
  context?: McpExecutionContext,
): Promise<JsonRpcResponse | null> {
  const hasId = rpc.id !== undefined;
  const id = hasId ? (rpc.id ?? null) : null;
  const method = rpc.method;
  const params = (
    rpc.params && typeof rpc.params === 'object' ? rpc.params : {}
  ) as Record<string, unknown>;

  if (typeof method !== 'string' || !method) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32600, message: 'Invalid Request: missing method' },
    };
  }

  if (method === 'initialize') {
    const requestedVersion =
      typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
    const negotiatedVersion = (
      SUPPORTED_PROTOCOL_VERSIONS as readonly string[]
    ).includes(requestedVersion)
      ? requestedVersion
      : MCP_SERVER_INFO.protocolVersion;

    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: negotiatedVersion,
        serverInfo: {
          name: MCP_SERVER_INFO.name,
          version: MCP_SERVER_INFO.version,
        },
        capabilities: {
          tools: { listChanged: true },
        },
      },
    };
  }

  if (
    method === 'notifications/initialized' ||
    method.startsWith('notifications/')
  ) {
    if (!hasId) {
      return null;
    }
    return {
      jsonrpc: '2.0',
      id,
      result: {},
    };
  }

  if (method === 'ping') {
    return {
      jsonrpc: '2.0',
      id,
      result: {},
    };
  }

  if (method === 'tools/list') {
    const freshUser = await getUserById(user.id);
    if (!freshUser || freshUser.isDisabled) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32001, message: 'Unauthorized or disabled account' },
      };
    }
    return {
      jsonrpc: '2.0',
      id,
      result: {
        tools: getMcpToolsForUser(freshUser),
      },
    };
  }

  if (method === 'tools/call') {
    const toolName = typeof params.name === 'string' ? params.name : '';
    const toolArgs =
      params.arguments &&
      typeof params.arguments === 'object' &&
      !Array.isArray(params.arguments)
        ? (params.arguments as Record<string, unknown>)
        : {};

    if (!toolName) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32602, message: 'Invalid params: missing tool name' },
      };
    }

    const freshUser = await getUserById(user.id);
    if (!freshUser || freshUser.isDisabled) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32001, message: 'Unauthorized or disabled account' },
      };
    }

    const caller = await resolveCallerContext(freshUser, context);

    try {
      let toolResult = await executeUserToolCall(caller, toolName, toolArgs);
      if (toolResult === null && isAdminUser(freshUser)) {
        toolResult = await executeAdminToolCall(caller, toolName, toolArgs);
      }

      if (toolResult === null) {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Unknown tool: ${toolName}` },
        };
      }
      return {
        jsonrpc: '2.0',
        id,
        result: toolResult,
      };
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id,
        result: wrapToolResult(
          { error: err instanceof Error ? err.message : 'Tool execution error' },
          true,
        ),
      };
    }
  }

  if (!hasId) {
    return null;
  }

  return {
    jsonrpc: '2.0',
    id,
    error: {
      code: -32601,
      message: `Method not found: ${method}`,
    },
  };
}
