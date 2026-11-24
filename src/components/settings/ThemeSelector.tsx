'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Check, Moon, Palette, Sun } from 'lucide-react';
import { apiFetch, toast } from '@/components/ui';
import {
  APP_THEMES,
  applyThemeToDocument,
  type AppTheme,
  type ThemeVariant,
} from '@/lib/theme';
import type { UserProfile } from '@/types/domain';

interface ThemeSelectorProps {
  theme: AppTheme;
  themeVariant: ThemeVariant;
  onUserUpdated: (user: UserProfile) => void;
}

interface PatchSettingsResponse {
  user: UserProfile;
}

function NotebookMiniPreview({ variant }: { variant: ThemeVariant }) {
  const isDark = variant === 'dark';
  const paperBg = isDark ? '#171512' : '#ece2c6';
  const dotColor = isDark ? 'rgba(244, 235, 216, 0.14)' : 'rgba(29, 26, 22, 0.14)';
  const cardBg = isDark ? '#231f1a' : '#fbf5e4';
  const inkColor = isDark ? '#f4ebd8' : '#1d1a16';
  const mutedColor = isDark ? '#b5aa96' : '#5d5446';
  const shadowColor = isDark ? '#080705' : '#1d1a16';
  const redColor = isDark ? '#e85a44' : '#d9412b';
  const goldColor = '#f2b632';
  const greenColor = isDark ? '#58b966' : '#2e7d3a';

  return (
    <div
      aria-hidden="true"
      className="relative h-24 w-full overflow-hidden p-2"
      style={{
        backgroundColor: paperBg,
        backgroundImage: `radial-gradient(${dotColor} 1px, transparent 1.2px)`,
        backgroundSize: '8px 8px',
        border: `2px solid ${inkColor}`,
        borderRadius: '3px 8px 4px 10px',
      }}
    >
      <div className="mb-1.5 flex items-center justify-between">
        <span
          className="text-[10px] font-bold tracking-wide"
          style={{
            color: redColor,
            fontFamily: '"Permanent Marker", cursive, sans-serif',
          }}
        >
          LIFTITUP
        </span>
        <span
          className="px-1.5 py-0.5 text-[8px] font-bold"
          style={{
            backgroundColor: goldColor,
            color: '#1d1a16',
            border: `1.5px solid ${inkColor}`,
            borderRadius: '999px',
          }}
        >
          TODAY
        </span>
      </div>

      <div
        className="flex items-center justify-between gap-2 px-2 py-1.5"
        style={{
          backgroundColor: cardBg,
          border: `2px solid ${inkColor}`,
          borderRadius: '4px 8px 4px 8px',
          boxShadow: `2px 2px 0 ${shadowColor}`,
        }}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div
            className="h-2 w-14 rounded-sm"
            style={{ backgroundColor: inkColor }}
          />
          <div
            className="h-1.5 w-10 rounded-sm"
            style={{ backgroundColor: mutedColor }}
          />
        </div>
        <div
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm"
          style={{
            backgroundColor: greenColor,
            border: `1.5px solid ${inkColor}`,
          }}
        >
          <span
            className="block h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: '#ffffff' }}
          />
        </div>
      </div>
    </div>
  );
}

function CutecoreMiniPreview() {
  return (
    <div
      aria-hidden="true"
      className="relative h-24 w-full overflow-hidden p-2"
      style={{
        backgroundColor: '#ffeaf2',
        backgroundImage:
          'linear-gradient(90deg, rgba(255, 59, 127, 0.09) 1px, transparent 1px), linear-gradient(rgba(255, 59, 127, 0.09) 1px, transparent 1px)',
        backgroundSize: '8px 8px',
        border: '2px solid #4a1c36',
        borderRadius: 0,
      }}
    >
      <div className="mb-1.5 flex items-center justify-between">
        <span
          className="text-[9px] font-bold uppercase tracking-wider"
          style={{
            color: '#ff3b7f',
            fontFamily: 'ui-monospace, Menlo, monospace',
          }}
        >
          KITTY.OS
        </span>
        <span
          className="px-1.5 py-0.5 text-[8px] font-bold"
          style={{
            backgroundColor: '#ffe07d',
            color: '#4a1c36',
            border: '1.5px solid #4a1c36',
            borderRadius: 0,
            fontFamily: 'ui-monospace, Menlo, monospace',
          }}
        >
          ★ PR
        </span>
      </div>

      <div
        className="flex items-center justify-between gap-2 px-2 py-1.5"
        style={{
          backgroundColor: '#fff8fb',
          border: '2px solid #4a1c36',
          boxShadow: '2px 2px 0 #f08cb5',
          borderRadius: 0,
        }}
      >
        {/* Pixel-art Hello Kitty-inspired cat silhouette with strawberry bow */}
        <svg
          width="28"
          height="24"
          viewBox="0 0 14 12"
          shapeRendering="crispEdges"
          className="shrink-0"
        >
          {/* Ears outline */}
          <rect x="2" y="1" width="2" height="1" fill="#4a1c36" />
          <rect x="10" y="1" width="2" height="1" fill="#4a1c36" />
          <rect x="1" y="2" width="1" height="2" fill="#4a1c36" />
          <rect x="4" y="2" width="6" height="1" fill="#4a1c36" />
          <rect x="12" y="2" width="1" height="2" fill="#4a1c36" />
          {/* Head fill */}
          <rect x="2" y="2" width="2" height="2" fill="#ffffff" />
          <rect x="10" y="2" width="2" height="2" fill="#ffffff" />
          <rect x="2" y="3" width="10" height="6" fill="#ffffff" />
          <rect x="3" y="9" width="8" height="1" fill="#ffffff" />
          {/* Head side/bottom outline */}
          <rect x="1" y="4" width="1" height="4" fill="#4a1c36" />
          <rect x="12" y="4" width="1" height="4" fill="#4a1c36" />
          <rect x="2" y="8" width="1" height="1" fill="#4a1c36" />
          <rect x="11" y="8" width="1" height="1" fill="#4a1c36" />
          <rect x="3" y="10" width="8" height="1" fill="#4a1c36" />
          {/* Eyes & yellow nose */}
          <rect x="4" y="6" width="1" height="1" fill="#4a1c36" />
          <rect x="9" y="6" width="1" height="1" fill="#4a1c36" />
          <rect x="6" y="7" width="2" height="1" fill="#ffe07d" />
          {/* Whiskers */}
          <rect x="0" y="5" width="1" height="1" fill="#4a1c36" />
          <rect x="0" y="7" width="1" height="1" fill="#4a1c36" />
          <rect x="13" y="5" width="1" height="1" fill="#4a1c36" />
          <rect x="13" y="7" width="1" height="1" fill="#4a1c36" />
          {/* Cute pixel bow */}
          <rect x="8" y="1" width="2" height="2" fill="#ff3b7f" />
          <rect x="11" y="1" width="2" height="2" fill="#ff3b7f" />
          <rect x="10" y="2" width="1" height="1" fill="#ffd0e2" />
        </svg>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div
            className="h-2 w-12"
            style={{ backgroundColor: '#4a1c36' }}
          />
          <div
            className="h-3 w-full"
            style={{
              backgroundColor: '#ff3b7f',
              border: '1.5px solid #4a1c36',
            }}
          />
        </div>
      </div>
    </div>
  );
}

function AnalogHorrorMiniPreview() {
  return (
    <div
      aria-hidden="true"
      className="relative h-24 w-full overflow-hidden p-2"
      style={{
        backgroundColor: '#0a0b0d',
        backgroundImage:
          'repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.05) 0px, rgba(255, 255, 255, 0.05) 1px, transparent 1px, transparent 3px)',
        boxShadow: 'inset 0 0 14px rgba(0, 0, 0, 0.85)',
        border: '2px solid #828791',
        borderRadius: '2px',
        fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
      }}
    >
      <div className="mb-1.5 flex items-center justify-between text-[9px] font-bold">
        <span style={{ color: '#d91e2a' }}>● REC</span>
        <span style={{ color: '#dcdad0' }}>CH-03</span>
      </div>

      <div
        className="mb-1.5 flex flex-col gap-1 px-2 py-1"
        style={{
          backgroundColor: '#121418',
          border: '1.5px solid #828791',
          borderRadius: '2px',
        }}
      >
        <div
          className="h-1.5 w-16"
          style={{ backgroundColor: '#dcdad0' }}
        />
        <div
          className="h-1.5 w-11"
          style={{ backgroundColor: '#828791' }}
        />
      </div>

      <div className="flex items-center gap-1">
        <div
          className="h-2.5 flex-1"
          style={{ backgroundColor: '#d6a319' }}
        />
        <div
          className="h-2.5 w-6"
          style={{ backgroundColor: '#d91e2a' }}
        />
      </div>
    </div>
  );
}

function BrazilianPhonkMiniPreview() {
  return (
    <div
      aria-hidden="true"
      className="relative h-24 w-full overflow-hidden p-2"
      style={{
        backgroundColor: '#09090d',
        backgroundImage:
          'repeating-linear-gradient(-45deg, rgba(57, 255, 20, 0.08) 0px, rgba(57, 255, 20, 0.08) 1px, transparent 1px, transparent 8px)',
        border: '2px solid #39ff14',
        borderRadius: '2px',
      }}
    >
      <div className="mb-1.5 flex items-center justify-between">
        <span
          className="text-[10px] font-black uppercase italic tracking-wider"
          style={{
            color: '#f4f7f5',
            fontFamily: 'Impact, "Arial Black", system-ui, sans-serif',
          }}
        >
          PHONK.MAX
        </span>
        <span
          className="px-1.5 py-0.5 text-[8px] font-black uppercase italic"
          style={{
            backgroundColor: '#d9ff00',
            color: '#09090d',
            border: '1.5px solid #39ff14',
            borderRadius: '2px',
          }}
        >
          DRIFT
        </span>
      </div>

      <div
        className="mb-1.5 flex items-center justify-between gap-2 px-2 py-1.5"
        style={{
          backgroundColor: '#13131b',
          border: '1.5px solid #39ff14',
          boxShadow: '2px 2px 0 #ff1e8a',
          borderRadius: '2px',
        }}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div
            className="h-1.5 w-14"
            style={{ backgroundColor: '#f4f7f5' }}
          />
          <div className="flex items-center gap-1">
            <div className="h-1.5 w-5" style={{ backgroundColor: '#39ff14' }} />
            <div className="h-1.5 w-4" style={{ backgroundColor: '#ff1e8a' }} />
            <div className="h-1.5 w-3" style={{ backgroundColor: '#00d9ff' }} />
          </div>
        </div>
        <div
          className="h-4 w-7 shrink-0"
          style={{
            backgroundColor: '#d9ff00',
            border: '1.5px solid #39ff14',
            boxShadow: '1px 1px 0 #ff1e8a',
          }}
        />
      </div>
    </div>
  );
}

function FutureFunkMiniPreview() {
  return (
    <div
      aria-hidden="true"
      className="relative h-24 w-full overflow-hidden p-2"
      style={{
        backgroundColor: '#170b2b',
        backgroundImage:
          'radial-gradient(circle at 65% 65%, rgba(255, 79, 216, 0.28), transparent 62%)',
        border: '2px solid #ff4fd8',
        borderRadius: '10px',
      }}
    >
      {/* Inline SVG: synthwave sunset + palm silhouette + horizon grid */}
      <svg
        viewBox="0 0 200 72"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-16 w-full"
      >
        <defs>
          <linearGradient id="ff-sunset" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffbe3b" />
            <stop offset="55%" stopColor="#ff4fd8" />
            <stop offset="100%" stopColor="#ff2e93" />
          </linearGradient>
        </defs>
        {/* Synthwave Sun */}
        <circle cx="136" cy="34" r="21" fill="url(#ff-sunset)" />
        {/* Sunset horizontal scan cutouts */}
        <rect x="112" y="34" width="48" height="2" fill="#170b2b" />
        <rect x="112" y="39" width="48" height="2.5" fill="#170b2b" />
        <rect x="112" y="45" width="48" height="3" fill="#170b2b" />
        {/* Horizon & perspective grid */}
        <rect x="0" y="47" width="200" height="25" fill="#1b0c34" />
        <line x1="0" y1="47" x2="200" y2="47" stroke="#29f2ff" strokeWidth="1.5" />
        <line x1="0" y1="53" x2="200" y2="53" stroke="#ff4fd8" strokeOpacity="0.45" strokeWidth="1" />
        <line x1="0" y1="60" x2="200" y2="60" stroke="#ff4fd8" strokeOpacity="0.55" strokeWidth="1" />
        <line x1="0" y1="68" x2="200" y2="68" stroke="#ff4fd8" strokeOpacity="0.65" strokeWidth="1" />
        <line x1="100" y1="47" x2="20" y2="72" stroke="#29f2ff" strokeOpacity="0.4" strokeWidth="1" />
        <line x1="100" y1="47" x2="70" y2="72" stroke="#29f2ff" strokeOpacity="0.4" strokeWidth="1" />
        <line x1="100" y1="47" x2="130" y2="72" stroke="#29f2ff" strokeOpacity="0.4" strokeWidth="1" />
        <line x1="100" y1="47" x2="180" y2="72" stroke="#29f2ff" strokeOpacity="0.4" strokeWidth="1" />
        {/* Palm silhouette */}
        <path
          d="M174 72 Q170 48 164 31 L168 31 Q175 48 180 72 Z"
          fill="#120624"
        />
        <path
          d="M165 32 Q150 25 142 33 Q153 31 164 34 Z M166 31 Q155 18 145 20 Q157 24 165 32 Z M167 31 Q177 18 189 22 Q178 24 168 32 Z M167 32 Q182 28 191 37 Q179 34 167 34 Z"
          fill="#120624"
          stroke="#ff4fd8"
          strokeOpacity="0.65"
          strokeWidth="0.8"
        />
      </svg>

      <div className="relative z-10 flex items-center justify-between">
        <span
          className="text-[9px] font-bold tracking-wider"
          style={{ color: '#fff4ff' }}
        >
          フューチャー
        </span>
        <span
          className="px-1.5 py-0.5 text-[8px] font-bold"
          style={{
            backgroundColor: '#ffbe3b',
            color: '#1b072e',
            border: '1.5px solid #ff4fd8',
            boxShadow: '2px 2px 0 #29f2ff',
            borderRadius: '6px',
          }}
        >
          FUNK
        </span>
      </div>

      <div
        className="relative z-10 mt-2 w-24 px-2 py-1.5"
        style={{
          backgroundColor: '#241142',
          border: '1.5px solid #ff4fd8',
          boxShadow: '2px 2px 0 #29f2ff',
          borderRadius: '8px',
        }}
      >
        <div
          className="mb-1 h-1.5 w-14 rounded-full"
          style={{ backgroundColor: '#fff4ff' }}
        />
        <div
          className="h-1.5 w-9 rounded-full"
          style={{ backgroundColor: '#29f2ff' }}
        />
      </div>
    </div>
  );
}

function LofiArtMiniPreview() {
  return (
    <div
      aria-hidden="true"
      className="relative h-24 w-full overflow-hidden p-2"
      style={{
        backgroundColor: '#1c1f33',
        backgroundImage:
          'radial-gradient(circle at 22% 58%, rgba(240, 182, 109, 0.22), transparent 55%)',
        border: '2px solid #6d6a8a',
        borderRadius: '10px',
      }}
    >
      {/* Inline SVG: rainy night window + warm desk lamp + steaming mug + sleepy cat */}
      <svg
        viewBox="0 0 200 72"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-16 w-full"
      >
        <defs>
          <radialGradient id="lofi-lamp-glow" cx="50%" cy="40%" r="55%">
            <stop offset="0%" stopColor="#f0b66d" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#f0b66d" stopOpacity="0" />
          </radialGradient>
        </defs>
        {/* Rainy window */}
        <rect
          x="104"
          y="4"
          width="84"
          height="46"
          rx="4"
          fill="#16192b"
          stroke="#6d6a8a"
          strokeWidth="2"
        />
        <line x1="146" y1="4" x2="146" y2="50" stroke="#6d6a8a" strokeWidth="1.5" />
        <line x1="104" y1="27" x2="188" y2="27" stroke="#6d6a8a" strokeWidth="1.5" />
        {/* Crescent moon */}
        <circle cx="171" cy="15" r="5" fill="#f0b66d" />
        <circle cx="173.5" cy="13.5" r="4.5" fill="#16192b" />
        {/* Rain streaks */}
        <line x1="115" y1="10" x2="111" y2="20" stroke="#78b7c9" strokeOpacity="0.7" strokeWidth="1.2" strokeLinecap="round" />
        <line x1="130" y1="14" x2="126" y2="24" stroke="#78b7c9" strokeOpacity="0.6" strokeWidth="1.2" strokeLinecap="round" />
        <line x1="122" y1="31" x2="118" y2="42" stroke="#78b7c9" strokeOpacity="0.7" strokeWidth="1.2" strokeLinecap="round" />
        <line x1="158" y1="30" x2="154" y2="41" stroke="#78b7c9" strokeOpacity="0.65" strokeWidth="1.2" strokeLinecap="round" />
        <line x1="176" y1="33" x2="172" y2="44" stroke="#78b7c9" strokeOpacity="0.55" strokeWidth="1.2" strokeLinecap="round" />

        {/* Desk surface */}
        <rect x="0" y="50" width="200" height="22" fill="#262a42" />
        <line x1="0" y1="50" x2="200" y2="50" stroke="#6d6a8a" strokeWidth="1.5" />

        {/* Warm lamp + glow */}
        <circle cx="34" cy="36" r="24" fill="url(#lofi-lamp-glow)" />
        <line x1="28" y1="50" x2="28" y2="28" stroke="#a6a3bd" strokeWidth="2.2" />
        <rect x="20" y="48" width="16" height="3" rx="1.5" fill="#a6a3bd" />
        <path d="M21 28 L35 28 L41 19 L25 19 Z" fill="#f0b66d" stroke="#efe6d8" strokeWidth="1" />

        {/* Steaming mug */}
        <rect x="64" y="40" width="12" height="10" rx="2" fill="#efe6d8" />
        <path d="M76 42 Q80 42 80 45 Q80 48 76 48" fill="none" stroke="#efe6d8" strokeWidth="1.5" />
        <path d="M67 37 Q65 34 68 31" fill="none" stroke="#78b7c9" strokeOpacity="0.8" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M72 37 Q74 34 71 30" fill="none" stroke="#efe6d8" strokeOpacity="0.65" strokeWidth="1.2" strokeLinecap="round" />

        {/* Sleepy cat silhouette on sill */}
        <ellipse cx="132" cy="46" rx="9" ry="5" fill="#101220" />
        <circle cx="123" cy="43" r="4" fill="#101220" />
        <polygon points="120,40 121,36 123,39" fill="#101220" />
        <polygon points="123,39 125,36 126,40" fill="#101220" />
        <path d="M140 47 Q147 47 146 42" fill="none" stroke="#101220" strokeWidth="2" strokeLinecap="round" />
      </svg>

      <div className="relative z-10 flex items-center justify-between">
        <span
          className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[8px] font-bold"
          style={{
            backgroundColor: '#262a42',
            color: '#efe6d8',
            border: '1.5px solid #6d6a8a',
          }}
        >
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: '#f0b66d' }}
          />
          LO-FI
        </span>
        <span
          className="text-[9px] font-bold"
          style={{ color: '#a6a3bd', fontFamily: 'ui-monospace, monospace' }}
        >
          23:45
        </span>
      </div>
    </div>
  );
}

function FrutigerAeroMiniPreview() {
  return (
    <div
      aria-hidden="true"
      className="relative h-24 w-full overflow-hidden p-2"
      style={{
        backgroundColor: '#cfeef7',
        backgroundImage:
          'linear-gradient(180deg, #a9dff2 0%, #d8f3fc 55%, #d4f0d8 100%)',
        border: '2px solid #2f7fa3',
        borderRadius: '18px',
      }}
    >
      {/* Inline SVG: sunlit sky, glossy rolling hills, and aqua glass bubbles */}
      <svg
        viewBox="0 0 200 72"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-16 w-full"
      >
        <defs>
          <linearGradient id="fa-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#9fdcef" />
            <stop offset="100%" stopColor="#dff5fd" />
          </linearGradient>
          <radialGradient id="fa-bubble" cx="35%" cy="30%" r="75%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="55%" stopColor="#bfe9f7" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#59b7d8" stopOpacity="0.35" />
          </radialGradient>
          <linearGradient id="fa-hill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8fd9a8" />
            <stop offset="100%" stopColor="#3fae5f" />
          </linearGradient>
          <linearGradient id="fa-hill-back" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#b8ec9f" />
            <stop offset="100%" stopColor="#74c98a" />
          </linearGradient>
        </defs>
        {/* Sky */}
        <rect x="0" y="0" width="200" height="52" fill="url(#fa-sky)" />
        {/* Sun glow */}
        <circle cx="164" cy="16" r="12" fill="#fff3c4" opacity="0.9" />
        <circle cx="164" cy="16" r="7" fill="#ffe478" />
        {/* Rolling hills */}
        <path
          d="M0 46 Q50 30 100 44 T200 42 L200 72 L0 72 Z"
          fill="url(#fa-hill-back)"
        />
        <path
          d="M0 52 Q60 40 120 52 T200 48 L200 72 L0 72 Z"
          fill="url(#fa-hill)"
        />
        {/* Glossy aqua bubbles */}
        <circle cx="34" cy="20" r="12" fill="url(#fa-bubble)" stroke="#ffffff" strokeOpacity="0.7" strokeWidth="1" />
        <circle cx="58" cy="34" r="7" fill="url(#fa-bubble)" stroke="#ffffff" strokeOpacity="0.7" strokeWidth="0.8" />
        <circle cx="118" cy="16" r="9" fill="url(#fa-bubble)" stroke="#ffffff" strokeOpacity="0.7" strokeWidth="1" />
        <circle cx="86" cy="28" r="4.5" fill="url(#fa-bubble)" stroke="#ffffff" strokeOpacity="0.6" strokeWidth="0.6" />
      </svg>

      <div className="relative z-10 flex items-center justify-between">
        <span
          className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[8px] font-bold"
          style={{
            backgroundColor: 'rgba(255, 255, 255, 0.75)',
            color: '#0c2a3d',
            border: '1.5px solid #2f7fa3',
            boxShadow: '0 1px 3px rgba(31, 111, 143, 0.35)',
          }}
        >
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{
              backgroundColor: '#ffb02e',
              boxShadow: '0 0 3px rgba(255, 176, 46, 0.8)',
            }}
          />
          AERO
        </span>
        <span
          className="rounded-full px-1.5 py-0.5 text-[8px] font-bold"
          style={{
            backgroundColor: 'rgba(255, 255, 255, 0.7)',
            color: '#0c2a3d',
            border: '1.5px solid #2f7fa3',
            fontFamily: '"Trebuchet MS", "Segoe UI", sans-serif',
          }}
        >
          2006
        </span>
      </div>
    </div>
  );
}

export function ThemeSelector({
  theme,
  themeVariant,
  onUserUpdated,
}: ThemeSelectorProps) {
  const [activeTheme, setActiveTheme] = useState<AppTheme>(theme);
  const [activeVariant, setActiveVariant] = useState<ThemeVariant>(themeVariant);
  const requestSeqRef = useRef(0);

  useEffect(() => {
    setActiveTheme(theme);
    setActiveVariant(themeVariant);
  }, [theme, themeVariant]);

  async function selectTheme(nextTheme: AppTheme, nextVariant: ThemeVariant) {
    if (nextTheme === activeTheme && nextVariant === activeVariant) return;

    const prevTheme = activeTheme;
    const prevVariant = activeVariant;
    const seq = ++requestSeqRef.current;

    setActiveTheme(nextTheme);
    setActiveVariant(nextVariant);
    applyThemeToDocument(nextTheme, nextVariant);

    try {
      const res = await apiFetch<PatchSettingsResponse>('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          theme: nextTheme,
          themeVariant: nextVariant,
        }),
      });
      if (seq !== requestSeqRef.current) return;
      onUserUpdated(res.user);
      window.dispatchEvent(new Event('liftitup:user-updated'));
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      setActiveTheme(prevTheme);
      setActiveVariant(prevVariant);
      applyThemeToDocument(prevTheme, prevVariant);
      toast.error(err instanceof Error ? err.message : 'Failed to save theme');
    }
  }

  return (
    <section className="card flex flex-col gap-3" aria-label="Theme">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Palette className="h-5 w-5 text-[var(--ink)]" />
          <h2 className="font-marker text-lg text-[var(--ink)]">Theme</h2>
        </div>
        <span className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
          {APP_THEMES.find((t) => t.id === activeTheme)?.name ?? 'Notebook'}
          {activeTheme === 'notebook'
            ? ` · ${activeVariant === 'dark' ? 'Dark' : 'Light'}`
            : ''}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {APP_THEMES.map((meta) => {
          const isSelected = activeTheme === meta.id;
          return (
            <div
              key={meta.id}
              className={`flex flex-col rounded-[var(--wob-sm)] border-[2.5px] p-2.5 transition ${
                isSelected
                  ? 'border-[var(--line)] bg-[var(--gold-bg)] shadow-[3px_3px_0_var(--shadow-color)]'
                  : 'border-[var(--line)]/55 bg-[var(--surface)]'
              }`}
            >
              <button
                type="button"
                aria-pressed={isSelected}
                onClick={() => selectTheme(meta.id, activeVariant)}
                className="flex w-full cursor-pointer flex-col gap-2 text-left"
              >
                {meta.id === 'notebook' && (
                  <NotebookMiniPreview variant={activeVariant} />
                )}
                {meta.id === 'cutecore' && <CutecoreMiniPreview />}
                {meta.id === 'analog-horror' && <AnalogHorrorMiniPreview />}
                {meta.id === 'brazilian-phonk' && <BrazilianPhonkMiniPreview />}
                {meta.id === 'future-funk' && <FutureFunkMiniPreview />}
                {meta.id === 'lofi-art' && <LofiArtMiniPreview />}
                {meta.id === 'frutiger-aero' && <FrutigerAeroMiniPreview />}

                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-marker text-base leading-tight text-[var(--ink)]">
                      {meta.name}
                    </div>
                    <div className="text-xs font-bold leading-snug text-[var(--muted)]">
                      {meta.subtitle}
                    </div>
                  </div>
                  {isSelected && (
                    <span
                      aria-label="Active theme"
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-[var(--line)] bg-[var(--gold)] text-[var(--btn-gold-fg)]"
                    >
                      <Check className="h-3 w-3" />
                    </span>
                  )}
                </div>
              </button>

              {meta.supportsVariants && (
                <div
                  role="group"
                  aria-label="Notebook light or dark mode"
                  className="mt-2 grid grid-cols-2 gap-1 rounded-lg border-2 border-[var(--line)] bg-[var(--surface-alt)] p-0.5"
                >
                  {(['light', 'dark'] as const).map((v) => {
                    const variantSelected =
                      activeTheme === 'notebook' && activeVariant === v;
                    return (
                      <button
                        key={v}
                        type="button"
                        aria-pressed={variantSelected}
                        onClick={(e) => {
                          e.stopPropagation();
                          selectTheme('notebook', v);
                        }}
                        className={`flex min-h-[34px] cursor-pointer items-center justify-center gap-1 rounded-md px-2 text-xs font-bold transition ${
                          variantSelected
                            ? 'bg-[var(--gold)] text-[var(--btn-gold-fg)] shadow-[1px_1px_0_var(--shadow-color)]'
                            : 'text-[var(--muted)]'
                        }`}
                      >
                        {v === 'light' ? (
                          <Sun className="h-3.5 w-3.5" />
                        ) : (
                          <Moon className="h-3.5 w-3.5" />
                        )}
                        {v === 'light' ? 'Light' : 'Dark'}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
