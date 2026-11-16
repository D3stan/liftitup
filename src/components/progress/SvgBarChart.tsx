'use client';

import React, { useMemo, useState } from 'react';

export interface BarChartPoint {
  label: string;
  value: number;
}

export interface SvgBarChartProps {
  points: BarChartPoint[];
  unitLabel?: string;
  barColor?: string;
  emptyLabel?: string;
}

function formatShortDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const [, m, d] = iso.split('-');
  return `${Number(m)}/${Number(d)}`;
}

export function SvgBarChart({
  points,
  unitLabel = '',
  barColor = 'var(--blue)',
  emptyLabel = 'No data yet',
}: SvgBarChartProps) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  const geom = useMemo(() => {
    if (points.length === 0) return null;

    const width = 560;
    const height = 165;
    const padLeft = 36;
    const padRight = 14;
    const padTop = 16;
    const padBottom = 28;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    const maxVal = Math.max(1, ...points.map((p) => p.value));
    const slotW = plotW / points.length;
    const barW = Math.min(34, Math.max(8, slotW * 0.65));

    const bars = points.map((pt, i) => {
      const h = (pt.value / maxVal) * plotH;
      const x = padLeft + i * slotW + (slotW - barW) / 2;
      const y = padTop + plotH - h;
      return { x, y, w: barW, h, pt, i };
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
      maxVal,
      bars,
    };
  }, [points]);

  if (!geom) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-[var(--muted)]">
        {emptyLabel}
      </div>
    );
  }

  const active =
    activeIdx !== null && geom.bars[activeIdx]
      ? geom.bars[activeIdx]
      : geom.bars[geom.bars.length - 1];

  return (
    <div className="w-full">
      <div className="mb-1 flex items-center justify-between text-xs text-[var(--muted)]">
        <span>Wk {formatShortDate(active.pt.label)}</span>
        <span className="font-bold text-[var(--ink)]">
          {active.pt.value}
          {unitLabel ? ` ${unitLabel}` : ''}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${geom.width} ${geom.height}`}
        className="w-full h-auto overflow-visible select-none"
        role="img"
        aria-label="Bar chart"
      >
        <line
          x1={geom.padLeft}
          y1={geom.padTop}
          x2={geom.width - geom.padRight}
          y2={geom.padTop}
          stroke="var(--ink)"
          strokeOpacity={0.14}
          strokeDasharray="4 4"
        />
        <text
          x={geom.padLeft - 6}
          y={geom.padTop + 4}
          textAnchor="end"
          fontSize="12"
          fill="var(--muted)"
        >
          {geom.maxVal}
        </text>
        <line
          x1={geom.padLeft}
          y1={geom.padTop + geom.plotH}
          x2={geom.width - geom.padRight}
          y2={geom.padTop + geom.plotH}
          stroke="var(--ink)"
          strokeOpacity={0.25}
        />
        <text
          x={geom.padLeft - 6}
          y={geom.padTop + geom.plotH + 4}
          textAnchor="end"
          fontSize="12"
          fill="var(--muted)"
        >
          0
        </text>

        {geom.bars.map((b) => {
          const isSelected = b.i === active.i;
          return (
            <g
              key={b.i}
              onClick={() => setActiveIdx(b.i)}
              className="cursor-pointer"
            >
              <rect
                x={b.x - 4}
                y={geom.padTop}
                width={b.w + 8}
                height={geom.plotH}
                fill="transparent"
              />
              <rect
                x={b.x}
                y={b.y}
                width={b.w}
                height={Math.max(2, b.h)}
                rx="3"
                fill={isSelected ? 'var(--gold)' : barColor}
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
