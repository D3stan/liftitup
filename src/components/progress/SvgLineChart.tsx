'use client';

import React, { useMemo, useState } from 'react';

export interface LineChartPoint {
  label: string;
  value: number;
  sublabel?: string;
}

export interface SvgLineChartProps {
  points: LineChartPoint[];
  unitLabel?: string;
  strokeColor?: string;
  emptyLabel?: string;
  secondaryPoints?: Array<number | null>;
  secondaryStrokeColor?: string;
  primaryLabel?: string;
  secondaryLabel?: string;
}

function formatShortDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const [, m, d] = iso.split('-');
  return `${Number(m)}/${Number(d)}`;
}

function formatNumber(val: number): string {
  return Number.isInteger(val) ? String(val) : val.toFixed(1);
}

export function SvgLineChart({
  points,
  unitLabel = '',
  strokeColor = 'var(--red)',
  emptyLabel = 'No data yet',
  secondaryPoints,
  secondaryStrokeColor = 'var(--blue)',
  primaryLabel,
  secondaryLabel,
}: SvgLineChartProps) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  const geom = useMemo(() => {
    if (points.length === 0) return null;

    const width = 560;
    const height = 190;
    const padLeft = 46;
    const padRight = 18;
    const padTop = 18;
    const padBottom = 30;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    const vals = points.map((p) => p.value);
    const secVals = (secondaryPoints ?? []).filter(
      (v): v is number => typeof v === 'number' && Number.isFinite(v),
    );
    const allVals = [...vals, ...secVals];
    const rawMin = Math.min(...allVals);
    const rawMax = Math.max(...allVals);
    const span = rawMax - rawMin;
    const pad = span > 0 ? span * 0.15 : Math.max(1, Math.abs(rawMax) * 0.1);
    const minVal = Math.max(0, rawMin - pad);
    const maxVal = rawMax + pad;
    const range = Math.max(0.001, maxVal - minVal);

    const toY = (val: number) =>
      padTop + plotH - ((val - minVal) / range) * plotH;

    const coords = points.map((pt, i) => {
      const x =
        points.length === 1
          ? padLeft + plotW / 2
          : padLeft + (i / (points.length - 1)) * plotW;
      const y = toY(pt.value);
      const secVal = secondaryPoints?.[i] ?? null;
      const secY =
        typeof secVal === 'number' && Number.isFinite(secVal)
          ? toY(secVal)
          : null;
      return { x, y, pt, i, secVal, secY };
    });

    const polyline = coords
      .map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`)
      .join(' ');

    const secondaryRuns: string[] = [];
    let currentRun: string[] = [];
    for (const c of coords) {
      if (c.secY !== null) {
        currentRun.push(`${c.x.toFixed(1)},${c.secY.toFixed(1)}`);
      } else if (currentRun.length > 0) {
        if (currentRun.length > 1) {
          secondaryRuns.push(currentRun.join(' '));
        }
        currentRun = [];
      }
    }
    if (currentRun.length > 1) {
      secondaryRuns.push(currentRun.join(' '));
    }

    const yTicks = [0, 0.5, 1].map((t) => {
      const v = minVal + t * range;
      const y = padTop + plotH - t * plotH;
      return {
        y,
        label: Number.isInteger(v) ? String(v) : v.toFixed(1),
      };
    });

    return {
      width,
      height,
      padLeft,
      padRight,
      padTop,
      padBottom,
      plotW,
      plotH,
      coords,
      polyline,
      secondaryRuns,
      hasSecondary: secVals.length > 0,
      yTicks,
    };
  }, [points, secondaryPoints]);

  if (!geom) {
    return (
      <div className="flex h-36 items-center justify-center text-sm text-[var(--muted)]">
        {emptyLabel}
      </div>
    );
  }

  const active =
    activeIdx !== null && geom.coords[activeIdx]
      ? geom.coords[activeIdx]
      : geom.coords[geom.coords.length - 1];

  return (
    <div className="w-full">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--muted)]">
        <span>
          {formatShortDate(active.pt.label)}
          {active.pt.sublabel ? ` · ${active.pt.sublabel}` : ''}
        </span>
        <div className="flex items-center gap-3">
          <span className="font-bold text-[var(--ink)]">
            {formatNumber(active.pt.value)}
            {unitLabel ? ` ${unitLabel}` : ''}
          </span>
          {active.secVal !== null && (
            <span className="font-bold" style={{ color: secondaryStrokeColor }}>
              {secondaryLabel ?? '7d avg'}: {formatNumber(active.secVal)}
              {unitLabel ? ` ${unitLabel}` : ''}
            </span>
          )}
        </div>
      </div>

      {(primaryLabel || (secondaryLabel && geom.hasSecondary)) && (
        <div className="mb-1.5 flex flex-wrap items-center gap-4 text-[11px] font-bold text-[var(--muted)]">
          {primaryLabel && (
            <span className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-0.5 w-4 rounded-full"
                style={{ backgroundColor: strokeColor }}
              />
              {primaryLabel}
            </span>
          )}
          {secondaryLabel && geom.hasSecondary && (
            <span className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-0.5 w-4 border-t-2 border-dashed"
                style={{ borderColor: secondaryStrokeColor }}
              />
              {secondaryLabel}
            </span>
          )}
        </div>
      )}

      <svg
        viewBox={`0 0 ${geom.width} ${geom.height}`}
        className="w-full h-auto overflow-visible select-none"
        role="img"
        aria-label="Line chart"
      >
        {geom.yTicks.map((tick, idx) => (
          <g key={idx}>
            <line
              x1={geom.padLeft}
              y1={tick.y}
              x2={geom.width - geom.padRight}
              y2={tick.y}
              stroke="var(--ink)"
              strokeOpacity={0.14}
              strokeDasharray="4 4"
            />
            <text
              x={geom.padLeft - 6}
              y={tick.y + 4}
              textAnchor="end"
              fontSize="12"
              fill="var(--muted)"
            >
              {tick.label}
            </text>
          </g>
        ))}

        {geom.secondaryRuns.map((runPoints, idx) => (
          <polyline
            key={`sec-${idx}`}
            fill="none"
            stroke={secondaryStrokeColor}
            strokeWidth="2.5"
            strokeDasharray="6 4"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={runPoints}
          />
        ))}

        {geom.coords.length > 1 && (
          <polyline
            fill="none"
            stroke={strokeColor}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={geom.polyline}
          />
        )}

        {active.secY !== null && (
          <circle
            cx={active.x}
            cy={active.secY}
            r="3.5"
            fill={secondaryStrokeColor}
            stroke="var(--card)"
            strokeWidth="1.5"
          />
        )}

        {geom.coords.map((c) => {
          const isSelected = c.i === active.i;
          return (
            <g
              key={c.i}
              onClick={() => setActiveIdx(c.i)}
              className="cursor-pointer"
            >
              <circle cx={c.x} cy={c.y} r="14" fill="transparent" />
              <circle
                cx={c.x}
                cy={c.y}
                r={isSelected ? 5.5 : 4}
                fill={isSelected ? 'var(--gold)' : strokeColor}
                stroke="var(--line)"
                strokeWidth="2"
              />
            </g>
          );
        })}

        <text
          x={geom.padLeft}
          y={geom.height - 6}
          textAnchor="start"
          fontSize="12"
          fill="var(--muted)"
        >
          {formatShortDate(points[0].label)}
        </text>
        {points.length > 1 && (
          <text
            x={geom.width - geom.padRight}
            y={geom.height - 6}
            textAnchor="end"
            fontSize="12"
            fill="var(--muted)"
          >
            {formatShortDate(points[points.length - 1].label)}
          </text>
        )}
      </svg>
    </div>
  );
}
