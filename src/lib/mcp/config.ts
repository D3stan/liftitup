export type McpAuthMode = 'bearer' | 'url_token';

export function normalizeMcpEndpointUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) return '/api/mcp';
  if (trimmed.endsWith('/api/mcp')) return trimmed;
  return `${trimmed}/api/mcp`;
}

/**
 * Builds the MCP Streamable HTTP endpoint URL with the API key embedded as
 * `?token=<api_key>` for clients that do not support custom Authorization headers.
 */
export function getMcpTokenEndpointUrl(
  baseUrl: string,
  apiKey?: string | null,
): string {
  const url = normalizeMcpEndpointUrl(baseUrl);
  const trimmedKey = apiKey?.trim();
  if (!trimmedKey) {
    return `${url}?token=<YOUR_API_KEY>`;
  }
  return `${url}?token=${encodeURIComponent(trimmedKey)}`;
}

/**
 * Builds a copyable MCP client configuration snippet (Claude / ChatGPT / Cursor)
 * for the user's personal Streamable HTTP endpoint.
 */
export function getMcpClientConfigSnippet(
  baseUrl: string,
  apiKey?: string | null,
  authMode: McpAuthMode = 'bearer',
): string {
  if (authMode === 'url_token') {
    return JSON.stringify(
      {
        mcpServers: {
          liftitup: {
            type: 'http',
            url: getMcpTokenEndpointUrl(baseUrl, apiKey),
          },
        },
      },
      null,
      2,
    );
  }

  const url = normalizeMcpEndpointUrl(baseUrl);
  const token = apiKey?.trim() || '<YOUR_API_KEY>';

  return JSON.stringify(
    {
      mcpServers: {
        liftitup: {
          type: 'http',
          url,
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      },
    },
    null,
    2,
  );
}
