'use client';

import React, { useEffect, useState } from 'react';
import { AlertTriangle, Check, Copy, KeyRound, RefreshCw } from 'lucide-react';
import { Button, apiFetch, toast } from '@/components/ui';
import { getMcpClientConfigSnippet, normalizeMcpEndpointUrl } from '@/lib/mcp/config';
import type { ApiKeyInfo } from '@/types/domain';
import { SettingsSubpageShell } from './SettingsSubpageShell';
import { useSettingsData } from './useSettingsData';

interface RegenerateKeyPayload {
  apiKey: string;
  keyPrefix: string;
  mcpUrl: string;
  apiKeyInfo: ApiKeyInfo;
}

export function SettingsIntegrationsView() {
  const { user, apiKeyInfo, setApiKeyInfo, loading } = useSettingsData();
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [origin, setOrigin] = useState('');
  const [regenBusy, setRegenBusy] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  async function copyText(id: string, text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      toast.success(`${label} copied`);
      setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 1800);
    } catch {
      toast.error('Copy failed');
    }
  }

  async function handleRegenerateKey() {
    setRegenBusy(true);
    try {
      const res = await apiFetch<RegenerateKeyPayload>(
        '/api/settings/api-key',
        { method: 'POST' },
      );
      setRevealedKey(res.apiKey);
      setApiKeyInfo(res.apiKeyInfo);
      toast.success('New key created');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to regenerate');
    } finally {
      setRegenBusy(false);
    }
  }

  const mcpUrl = origin ? normalizeMcpEndpointUrl(origin) : '/api/mcp';
  const snippet = getMcpClientConfigSnippet(
    origin || 'https://lift.0xpuddu.com',
    revealedKey,
  );

  return (
    <SettingsSubpageShell title="Integrations" user={user} loading={loading}>
      {user && (
        <section className="card flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-[var(--ink)]" />
            <h2 className="font-marker text-lg text-[var(--ink)]">MCP</h2>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
              Endpoint
            </span>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={mcpUrl}
                aria-label="MCP Endpoint"
                className="min-h-[44px] w-full rounded-xl border-2 border-[var(--line)] bg-[var(--surface)] px-3 text-base"
              />
              <Button
                variant="alt"
                size="icon"
                onClick={() => copyText('mcp-url', mcpUrl, 'Endpoint')}
                aria-label="Copy MCP endpoint"
                className="min-h-[44px] min-w-[44px] shrink-0"
              >
                {copiedId === 'mcp-url' ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex flex-col">
                <span className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
                  API Key
                </span>
                <span className="font-mono text-sm">
                  {apiKeyInfo ? `${apiKeyInfo.keyPrefix}••••` : 'None'}
                </span>
              </div>
              <Button
                variant="alt"
                loading={regenBusy}
                onClick={handleRegenerateKey}
                className="min-h-[44px] gap-1.5"
              >
                <RefreshCw className="h-4 w-4" />
                {apiKeyInfo ? 'Regenerate' : 'Generate Key'}
              </Button>
            </div>
            <div
              role="note"
              className="flex items-start gap-2 rounded-xl border-2 border-[var(--line)] bg-[var(--gold-bg)] p-2.5 text-xs text-[var(--ink)]"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--red)]" />
              <div className="space-y-1">
                <p>
                  Your single API key is shared between MCP and the Apple Health
                  Shortcut. Regenerating it immediately revokes the previous key
                  (breaking the Shortcut/MCP client until updated) and
                  invalidates pending MCP confirmations.
                </p>
                <p className="font-bold">
                  Admin warning: if your user ID is listed in{' '}
                  <code className="font-mono">ADMIN_USER_IDS</code>, this key
                  (including inside the iOS Shortcut) grants full admin power
                  over the instance via MCP. Regenerate it here immediately if
                  ever exposed.
                </p>
              </div>
            </div>
          </div>

          {revealedKey && (
            <div className="flex flex-col gap-1.5 rounded-xl border-2 border-[var(--line)] bg-[var(--gold-bg)] p-3">
              <span className="text-xs font-bold uppercase tracking-wide text-[var(--ink)]">
                Copy Key Now
              </span>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={revealedKey}
                  aria-label="Generated API Key"
                  className="min-h-[44px] w-full rounded-xl border-2 border-[var(--line)] bg-[var(--surface)] px-3 font-mono text-base"
                />
                <Button
                  variant="primary"
                  size="icon"
                  onClick={() => copyText('api-key', revealedKey, 'API key')}
                  aria-label="Copy API key"
                  className="min-h-[44px] min-w-[44px] shrink-0"
                >
                  {copiedId === 'api-key' ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
                Client Config
              </span>
              <Button
                variant="alt"
                onClick={() => copyText('mcp-snippet', snippet, 'Config')}
                className="min-h-[44px] gap-1.5 px-3 text-sm"
              >
                {copiedId === 'mcp-snippet' ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                Copy
              </Button>
            </div>
            <pre className="overflow-x-auto rounded-xl border-2 border-[var(--line)] bg-[var(--surface)] p-3 font-mono text-xs">
              {snippet}
            </pre>
          </div>
        </section>
      )}
    </SettingsSubpageShell>
  );
}
