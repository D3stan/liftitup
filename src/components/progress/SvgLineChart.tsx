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
}

function formatShortDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const [, m, d] = iso.split('-');
  return `${Number(m)}/${Number(d)}`;
}

export function SvgLineChart({
  points,
  unitLabel = '',
  strokeColor = 'var(--red)',
  emptyLabel = 'No data yet',
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
    const rawMin = Math.min(...vals);
    const rawMax = Math.max(...vals);
    const span = rawMax - rawMin;
    const pad = span > 0 ? span * 0.15 : Math.max(1, Math.abs(rawMax) * 0.1);
    const minVal = Math.max(0, rawMin - pad);
    const maxVal = rawMax + pad;
    const range = Math.max(0.001, maxVal - minVal);

    const coords = points.map((pt, i) => {
      const x =
        points.length === 1
          ? padLeft + plotW / 2
          : padLeft + (i / (points.length - 1)) * plotW;
      const y = padTop + plotH - ((pt.value - minVal) / range) * plotH;
      return { x, y, pt, i };
    });

    const polyline = coords
      .map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`)
      .join(' ');

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
      yTicks,
    };
  }, [points]);

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
      <div className="mb-1 flex items-center justify-between text-xs text-[var(--muted)]">
        <span>
          {formatShortDate(active.pt.label)}
          {active.pt.sublabel ? ` · ${active.pt.sublabel}` : ''}
        </span>
        <span className="font-bold text-[var(--ink)]">
          {Number.isInteger(active.pt.value)
            ? active.pt.value
            : active.pt.value.toFixed(1)}
          {unitLabel ? ` ${unitLabel}` : ''}
        </span>
      </div>
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
