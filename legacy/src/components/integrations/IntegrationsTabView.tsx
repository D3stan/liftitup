'use client';

import React, { useState } from 'react';
import type { IntegrationsTabViewProps } from '@/types/domain';
import AiRoutineCompiler from './AiRoutineCompiler';
import McpConnectPanel from './McpConnectPanel';
import AppleFitnessPanel from './AppleFitnessPanel';
import { Bot, Plug, Watch, Layers } from 'lucide-react';

type IntegrationSubTab = 'compiler' | 'mcp' | 'apple' | 'all';

export default function IntegrationsTabView({
  user,
  schedule,
  analytics,
  exercises,
  onRefresh,
  onUserUpdated,
  onShowToast,
}: IntegrationsTabViewProps) {
  const [subTab, setSubTab] = useState<IntegrationSubTab>('compiler');

  return (
    <div className="space-y-4">
      {/* Segmented Navigation Bar */}
      <div className="card !p-2.5 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap px-1">
          <div className="font-marker text-base tracking-wide">
            🤖 AI COMPILER · 🔌 MCP SERVER · ⌚ APPLE HEALTH
          </div>
          <button
            type="button"
            onClick={() =>
              setSubTab((prev) => (prev === 'all' ? 'compiler' : 'all'))
            }
            className={`pill text-xs cursor-pointer ${
              subTab === 'all' ? 'gold' : ''
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            {subTab === 'all' ? 'Showing All Stacked' : 'View All Stacked'}
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => setSubTab('compiler')}
            className={`btn !px-2.5 !py-2 text-sm flex-col sm:flex-row !gap-1 ${
              subTab === 'compiler' ? '' : 'alt'
            }`}
          >
            <Bot className="w-4 h-4 shrink-0" />
            <span className=" leading-tight text-center">
              🤖 AI Compiler
            </span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab('mcp')}
            className={`btn !px-2.5 !py-2 text-sm flex-col sm:flex-row !gap-1 ${
              subTab === 'mcp' ? '' : 'alt'
            }`}
          >
            <Plug className="w-4 h-4 shrink-0" />
            <span className="leading-tight text-center">
              🔌 MCP Server
            </span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab('apple')}
            className={`btn !px-2.5 !py-2 text-sm flex-col sm:flex-row !gap-1 ${
              subTab === 'apple' ? '' : 'alt'
            }`}
          >
            <Watch className="w-4 h-4 shrink-0" />
            <span className="leading-tight text-center">
              ⌚ Apple Watch
            </span>
          </button>
        </div>
      </div>

      {/* Active Sub-View(s) */}
      {(subTab === 'compiler' || subTab === 'all') && (
        <AiRoutineCompiler
          user={user}
          schedule={schedule}
          analytics={analytics}
          exercises={exercises}
          onRefresh={onRefresh}
          onShowToast={onShowToast}
        />
      )}

      {(subTab === 'mcp' || subTab === 'all') && (
        <McpConnectPanel
          user={user}
          onRefresh={onRefresh}
          onUserUpdated={onUserUpdated}
          onShowToast={onShowToast}
        />
      )}

      {(subTab === 'apple' || subTab === 'all') && (
        <AppleFitnessPanel
          user={user}
          analytics={analytics}
          onRefresh={onRefresh}
          onUserUpdated={onUserUpdated}
          onShowToast={onShowToast}
        />
      )}
    </div>
  );
}
