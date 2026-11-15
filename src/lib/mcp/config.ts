export function normalizeMcpEndpointUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) return '/api/mcp';
  if (trimmed.endsWith('/api/mcp')) return trimmed;
  return `${trimmed}/api/mcp`;
}

/**
 * Builds a copyable MCP client configuration snippet (Claude / ChatGPT / Cursor)
 * for the user's personal Streamable HTTP endpoint.
 */
export function getMcpClientConfigSnippet(
  baseUrl: string,
  apiKey?: string | null,
): string {
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
