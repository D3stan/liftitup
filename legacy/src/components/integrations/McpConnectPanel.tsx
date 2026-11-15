'use client';

import React, { useState, useEffect } from 'react';
import type { UserProfile } from '@/types/domain';
import {
  Terminal,
  Copy,
  Check,
  Play,
  KeyRound,
  RefreshCw,
  Eye,
  EyeOff,
  Server,
  Sparkles,
  BookOpen,
} from 'lucide-react';

export interface McpConnectPanelProps {
  user: UserProfile;
  onRefresh: () => Promise<void>;
  onUserUpdated: (user: UserProfile) => void;
  onShowToast: (message: string) => void;
}

interface McpToolPreset {
  name: string;
  label: string;
  description: string;
  mutatesState?: boolean;
  defaultArgs: Record<string, unknown>;
}

const MCP_TOOL_PRESETS: McpToolPreset[] = [
  {
    name: 'get_precompiled_session',
    label: '1. get_precompiled_session',
    description:
      'Runs the Smart Double-Progression Engine for today (or a specific dayOfWeek) with target weights, reps, RIR, and progression badges.',
    defaultArgs: {
      date: new Date().toISOString().slice(0, 10),
    },
  },
  {
    name: 'swap_exercise_variation',
    label: '2. swap_exercise_variation (Pulley ↔ Chin-up)',
    description:
      'Translates target weight across biomechanical siblings (e.g., Lat Pulldown 80kg → Weighted Chin-up at user bodyweight + belt load).',
    mutatesState: false,
    defaultArgs: {
      fromExerciseId: 'lat-pulldown-pulley',
      toExerciseId: 'weighted-chin-up',
      targetReps: 8,
      targetRir: 1,
      scope: 'session',
    },
  },
  {
    name: 'get_schedule',
    label: '3. get_schedule',
    description:
      'Returns the user’s active 7-day weekly hypertrophy split, routine labels, movement slots, and target rep/RIR ranges.',
    defaultArgs: {},
  },
  {
    name: 'get_progress_analytics',
    label: '4. get_progress_analytics',
    description:
      'Returns weekly fractional sets vs MEV/MAV/MRV landmarks, 72h muscle recovery status, e1RM trends, and Boss Milestones.',
    defaultArgs: {},
  },
  {
    name: 'list_exercises',
    label: '5. list_exercises',
    description:
      'Lists canonical exercises filterable by movementSlot or primaryMuscle, including equivalence ratios and bodyweight factors.',
    defaultArgs: {
      movementSlot: 'vertical_pull',
    },
  },
  {
    name: 'log_workout_session',
    label: '6. log_workout_session',
    description:
      'Logs a workout session via MCP JSON-RPC, calculating XP, PRs, and updating 72h muscle fatigue.',
    mutatesState: true,
    defaultArgs: {
      routineLabel: 'MCP Agent Express Arm & Lat Pump',
      durationMinutes: 42,
      notes: 'Logged directly via LiftItUp MCP Server!',
      sets: [
        {
          exerciseId: 'weighted-chin-up',
          setNumber: 1,
          weightKg: 15,
          reps: 8,
          rir: 1,
        },
        {
          exerciseId: 'weighted-chin-up',
          setNumber: 2,
          weightKg: 15,
          reps: 8,
          rir: 1,
        },
        {
          exerciseId: 'bayesian-cable-curl',
          setNumber: 1,
          weightKg: 22.5,
          reps: 12,
          rir: 1,
        },
      ],
    },
  },
  {
    name: 'upsert_schedule',
    label: '7. upsert_schedule',
    description:
      'Updates the active weekly hypertrophy split or swaps default exercises via structured JSON.',
    mutatesState: true,
    defaultArgs: {
      name: 'MCP Agent 4-Day Upper/Lower Split',
      splitType: 'upper_lower',
      days: [
        {
          dayOfWeek: 0,
          routineLabel: 'Upper A — Chin-ups & Bench',
          isRestDay: false,
          slots: [
            {
              movementSlot: 'vertical_pull',
              exerciseId: 'weighted-chin-up',
              targetSets: 4,
              repRangeMin: 6,
              repRangeMax: 8,
              targetRir: 1,
              restSeconds: 150,
            },
            {
              movementSlot: 'horizontal_press',
              exerciseId: 'barbell-bench-press',
              targetSets: 3,
              repRangeMin: 6,
              repRangeMax: 8,
              targetRir: 1,
              restSeconds: 150,
            },
          ],
        },
      ],
    },
  },
];

const MCP_RESOURCES = [
  { uri: 'liftitup://user/profile', label: 'Athlete Profile & Rank' },
  { uri: 'liftitup://schedule/active', label: 'Active Weekly Split' },
  { uri: 'liftitup://workout/today', label: "Today's Precompiled Session" },
  { uri: 'liftitup://analytics/summary', label: 'MEV/MAV/MRV & 72h Recovery' },
];

export default function McpConnectPanel({
  user,
  onRefresh,
  onUserUpdated,
  onShowToast,
}: McpConnectPanelProps) {
  const [origin, setOrigin] = useState<string>('https://lift.0xpuddu.com');
  const [showKey, setShowKey] = useState<boolean>(false);
  const [copiedConfig, setCopiedConfig] = useState<boolean>(false);
  const [copiedKey, setCopiedKey] = useState<boolean>(false);
  const [rotatingKey, setRotatingKey] = useState<boolean>(false);

  // Playground state
  const [selectedToolName, setSelectedToolName] = useState<string>(
    MCP_TOOL_PRESETS[0].name
  );
  const [argsJsonText, setArgsJsonText] = useState<string>(
    JSON.stringify(MCP_TOOL_PRESETS[0].defaultArgs, null, 2)
  );
  const [runningRpc, setRunningRpc] = useState<boolean>(false);
  const [rpcResponseText, setRpcResponseText] = useState<string>('');
  const [lastRpcMethod, setLastRpcMethod] = useState<string>('');

  useEffect(() => {
    if (typeof window !== 'undefined' && window.location?.origin) {
      setOrigin(window.location.origin);
    }
  }, []);

  const mcpEndpoint = `${origin}/api/mcp`;

  const selectedTool =
    MCP_TOOL_PRESETS.find((t) => t.name === selectedToolName) ||
    MCP_TOOL_PRESETS[0];

  const mcpClientConfigJson = JSON.stringify(
    {
      mcpServers: {
        liftitup: {
          url: mcpEndpoint,
          headers: {
            Authorization: `Bearer ${user.apiKey}`,
          },
        },
      },
    },
    null,
    2
  );

  const handleSelectTool = (toolName: string) => {
    setSelectedToolName(toolName);
    const preset = MCP_TOOL_PRESETS.find((t) => t.name === toolName);
    if (preset) {
      setArgsJsonText(JSON.stringify(preset.defaultArgs, null, 2));
    }
  };

  const handleCopyKey = async () => {
    try {
      await navigator.clipboard.writeText(user.apiKey);
      setCopiedKey(true);
      onShowToast('Copied personal API key to clipboard!');
      setTimeout(() => setCopiedKey(false), 2000);
    } catch {
      onShowToast('Could not copy API key automatically.');
    }
  };

  const handleCopyConfig = async () => {
    try {
      await navigator.clipboard.writeText(mcpClientConfigJson);
      setCopiedConfig(true);
      onShowToast('Copied mcpServers JSON config for Claude / Cursor / AGY!');
      setTimeout(() => setCopiedConfig(false), 2500);
    } catch {
      onShowToast('Could not copy MCP config automatically.');
    }
  };

  const handleRotateApiKey = async () => {
    setRotatingKey(true);
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rotate_api_key' }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.user) {
          onUserUpdated(data.user);
          onShowToast('Generated a fresh personal API key!');
        }
      }
    } catch {
      onShowToast('Failed to rotate API key');
    } finally {
      setRotatingKey(false);
    }
  };

  const executeJsonRpc = async (
    method: string,
    params: Record<string, unknown>,
    mutatesState = false
  ) => {
    setRunningRpc(true);
    setLastRpcMethod(method);
    try {
      const rpcRequest = {
        jsonrpc: '2.0',
        id: Date.now(),
        method,
        params,
      };

      const res = await fetch('/api/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${user.apiKey}`,
        },
        body: JSON.stringify(rpcRequest),
      });

      const data = await res.json();
      setRpcResponseText(JSON.stringify(data, null, 2));

      if (mutatesState && !data.error) {
        await onRefresh();
        onShowToast(`MCP tool "${params.name || method}" executed & synced!`);
      } else {
        onShowToast(`MCP ${method} succeeded (${res.status} OK)`);
      }
    } catch (err) {
      setRpcResponseText(
        JSON.stringify(
          {
            jsonrpc: '2.0',
            error: {
              code: -32603,
              message:
                err instanceof Error ? err.message : 'MCP execution failed',
            },
          },
          null,
          2
        )
      );
    } finally {
      setRunningRpc(false);
    }
  };

  const handleRunSelectedTool = async () => {
    let parsedArgs: Record<string, unknown> = {};
    try {
      parsedArgs = argsJsonText.trim() ? JSON.parse(argsJsonText) : {};
    } catch (err) {
      onShowToast(
        `Invalid JSON arguments: ${
          err instanceof Error ? err.message : 'Check syntax'
        }`
      );
      return;
    }

    await executeJsonRpc(
      'tools/call',
      {
        name: selectedTool.name,
        arguments: parsedArgs,
      },
      Boolean(selectedTool.mutatesState)
    );
  };

  const handleReadResource = async (uri: string) => {
    await executeJsonRpc('resources/read', { uri }, false);
  };

  return (
    <div className="space-y-4">
      {/* Intro Hero Card */}
      <div className="hero-card space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Server className="w-6 h-6 text-[#1d1a16]" />
            <h2 className="text-xl font-marker">
              BUILT-IN MCP SERVER &amp; AGENT HUB
            </h2>
          </div>
          <span className="pill green text-xs">
            JSON-RPC 2.0 · 7 Tools · 4 Resources
          </span>
        </div>
        <p className="text-base leading-snug">
          Connect <strong>Claude Desktop</strong>, <strong>Cursor</strong>,{' '}
          <strong>Antigravity</strong>, or any MCP client directly to your
          hypertrophy notebook. Your AI agent can inspect your schedule, compute
          Pulley ↔ Chin-up equivalence, precompile sessions, and log sets!
        </p>
      </div>

      {/* Personal API Key & Endpoint Card */}
      <section className="card space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-[#d9412b]" />
            <h3 className="text-lg font-marker">
              ENDPOINT &amp; PERSONAL API KEY ({user.username.toUpperCase()})
            </h3>
          </div>
          <span className="pill text-xs">Multi-User Scoped</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div className="card-sm space-y-1">
            <div className="text-xs font-bold uppercase text-[#5d5446]">
              Live MCP Server Endpoint
            </div>
            <div className="font-mono text-sm font-bold break-all">
              {mcpEndpoint}
            </div>
          </div>

          <div className="card-sm space-y-1">
            <div className="text-xs font-bold uppercase text-[#5d5446]">
              Personal Bearer API Key
            </div>
            <div className="flex items-center justify-between gap-2">
              <code className="font-mono text-sm font-bold break-all">
                {showKey
                  ? user.apiKey
                  : `${user.apiKey.slice(0, 10)}••••••••••••${user.apiKey.slice(
                      -4
                    )}`}
              </code>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowKey((s) => !s)}
                  className="btn icon !w-9 !h-9 !min-w-0 !min-h-0 alt"
                  title={showKey ? 'Hide API Key' : 'Show API Key'}
                >
                  {showKey ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleCopyKey}
                  className="btn icon !w-9 !h-9 !min-w-0 !min-h-0"
                  title="Copy API Key"
                >
                  {copiedKey ? (
                    <Check className="w-4 h-4 text-[#2e7d3a]" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 1-Tap Copyable mcpServers Config */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-sm font-bold text-[#5d5446]">
              Claude Desktop / Cursor / Antigravity `mcpServers` Config:
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleRotateApiKey}
                disabled={rotatingKey}
                className="btn alt !min-h-[36px] !px-2.5 !py-1 text-xs"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${rotatingKey ? 'animate-spin' : ''}`}
                />
                Rotate Key
              </button>
              <button
                type="button"
                onClick={handleCopyConfig}
                className="btn !min-h-[36px] !px-3 !py-1 text-xs"
              >
                {copiedConfig ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-[#2e7d3a]" />
                    Copied Config!
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    Copy MCP Config JSON
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="card-sm bg-[#1d1a16] text-[#fbf5e4] overflow-x-auto">
            <pre className="text-xs font-mono leading-relaxed">
              {mcpClientConfigJson}
            </pre>
          </div>
        </div>
      </section>

      {/* Interactive In-App MCP Playground */}
      <section className="card space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Terminal className="w-5 h-5 text-[#2b5fa8]" />
            <h3 className="text-lg font-marker">
              INTERACTIVE IN-APP MCP PLAYGROUND
            </h3>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => executeJsonRpc('tools/list', {}, false)}
              className="btn alt !min-h-[36px] !px-2.5 !py-1 text-xs"
            >
              <Sparkles className="w-3.5 h-3.5 text-[#d9412b]" />
              tools/list
            </button>
            <button
              type="button"
              onClick={() => executeJsonRpc('resources/list', {}, false)}
              className="btn alt !min-h-[36px] !px-2.5 !py-1 text-xs"
            >
              <BookOpen className="w-3.5 h-3.5 text-[#2b5fa8]" />
              resources/list
            </button>
          </div>
        </div>

        {/* Quick Resource Reader Pills */}
        <div className="space-y-1">
          <div className="text-xs font-bold uppercase text-[#5d5446]">
            1-Tap Read MCP Resources (`resources/read`):
          </div>
          <div className="flex flex-wrap gap-1.5">
            {MCP_RESOURCES.map((resItem) => (
              <button
                key={resItem.uri}
                type="button"
                onClick={() => handleReadResource(resItem.uri)}
                className="pill blue text-xs cursor-pointer active:translate-y-0.5"
              >
                <BookOpen className="w-3.5 h-3.5" />
                {resItem.uri}
              </button>
            ))}
          </div>
        </div>

        {/* Tool Picker & JSON Arguments Editor */}
        <div className="space-y-2 pt-1">
          <label
            htmlFor="mcp-tool-select"
            className="block text-sm font-bold text-[#5d5446]"
          >
            Select one of the 7 MCP Tools (`tools/call`):
          </label>
          <select
            id="mcp-tool-select"
            value={selectedToolName}
            onChange={(e) => handleSelectTool(e.target.value)}
            className="nb-input font-bold cursor-pointer"
          >
            {MCP_TOOL_PRESETS.map((tool) => (
              <option key={tool.name} value={tool.name}>
                {tool.label}
              </option>
            ))}
          </select>

          <div className="note text-sm">
            <strong>{selectedTool.name}:</strong> {selectedTool.description}
          </div>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="mcp-tool-args"
            className="block text-sm font-bold text-[#5d5446]"
          >
            Tool Arguments (`params.arguments` JSON):
          </label>
          <textarea
            id="mcp-tool-args"
            rows={5}
            value={argsJsonText}
            onChange={(e) => setArgsJsonText(e.target.value)}
            className="nb-input !font-mono !text-base resize-y"
          />
        </div>

        <button
          type="button"
          onClick={handleRunSelectedTool}
          disabled={runningRpc}
          className="btn big w-full"
        >
          {runningRpc ? (
            <>
              <RefreshCw className="w-5 h-5 animate-spin" />
              Executing MCP JSON-RPC...
            </>
          ) : (
            <>
              <Play className="w-5 h-5 fill-current" />
              ▶ Run MCP Tool (`{selectedTool.name}`)
            </>
          )}
        </button>

        {/* Live JSON-RPC Response Inspector */}
        {rpcResponseText && (
          <div className="space-y-1.5 pt-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-marker text-[#2e7d3a]">
                LIVE JSON-RPC 2.0 RESPONSE ({lastRpcMethod}):
              </span>
              <button
                type="button"
                onClick={() => setRpcResponseText('')}
                className="text-xs font-bold underline text-[#5d5446]"
              >
                Clear Output
              </button>
            </div>
            <div className="card-sm bg-[#1d1a16] text-[#cde6c0] overflow-x-auto max-h-80">
              <pre className="text-xs font-mono whitespace-pre-wrap leading-relaxed">
                {rpcResponseText}
              </pre>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
