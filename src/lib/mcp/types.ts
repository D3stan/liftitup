import type { UserProfile } from '@/types/domain';

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface McpToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: McpToolAnnotations;
}

export type McpTextContent = {
  type: 'text';
  text: string;
};

export type McpImageContent = {
  type: 'image';
  data: string;
  mimeType: 'image/jpeg';
};

export type McpContentBlock = McpTextContent | McpImageContent;

export interface McpToolResult {
  content: McpContentBlock[];
  structuredContent?: unknown;
  isError: boolean;
}

export interface McpExecutionContext {
  apiKeyId?: string | null;
  apiKeyPrefix?: string | null;
  origin?: string | null;
}

export interface ResolvedMcpCaller {
  user: UserProfile;
  apiKeyId: string;
  apiKeyPrefix: string;
  origin: string | null;
}

export function wrapToolResult(data: unknown, isError = false): McpToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(data, null, 2),
      },
    ],
    structuredContent: data,
    isError,
  };
}
