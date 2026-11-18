'use client';

import React from 'react';
import type { AdminAdoptionReport } from '@/lib/admin/adoption';
import { formatDateTime } from './formatters';

export function AdminAdoptionView({
  initialData,
}: {
  initialData: AdminAdoptionReport;
}) {
  const data = initialData;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-marker text-2xl text-[var(--ink)]">
          Feature Adoption &amp; Catalog
        </h1>
        <p className="text-xs text-[var(--muted)]">
          Computed across {data.registeredUserCount} registered user(s) ·
          Snapshot: {formatDateTime(data.snapshotComputedAt)}
        </p>
      </div>

      {/* Feature Adoption */}
      <section className="card space-y-3">
        <h2 className="font-marker text-lg text-[var(--ink)]">
          Features (Ever vs Last 30 Days)
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b-2 border-[var(--line)] text-xs uppercase text-[var(--muted)]">
                <th className="py-2 pr-3">Feature</th>
                <th className="py-2 px-2">Ever Used</th>
                <th className="py-2 px-2">Last 30d</th>
                <th className="py-2 pl-2">Adoption</th>
              </tr>
            </thead>
            <tbody>
              {data.features.map((f) => (
                <tr key={f.key} className="border-b border-[var(--line)]/20">
                  <td className="py-2 pr-3 font-bold">{f.label}</td>
                  <td className="py-2 px-2 font-mono">{f.everUsers}</td>
                  <td className="py-2 px-2 font-mono">{f.last30dUsers}</td>
                  <td className="py-2 pl-2 font-mono">{f.adoptionPct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Modes & Themes */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="card space-y-2.5">
          <h2 className="font-marker text-lg text-[var(--ink)]">
            Clock &amp; Workout View Preferences
          </h2>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl border-2 border-[var(--line)] bg-[var(--surface)] p-3">
              <div className="text-xs font-bold uppercase text-[var(--muted)]">
                Rest Clock
              </div>
              <div className="mt-1 font-bold">
                Stopwatch: {data.restClockDistribution.stopwatch}
              </div>
              <div className="font-bold">
                Countdown: {data.restClockDistribution.countdown}
              </div>
            </div>
            <div className="rounded-xl border-2 border-[var(--line)] bg-[var(--surface)] p-3">
              <div className="text-xs font-bold uppercase text-[var(--muted)]">
                Default View
              </div>
              <div className="mt-1 font-bold">
                List: {data.workoutViewDistribution.list}
              </div>
              <div className="font-bold">
                Focus: {data.workoutViewDistribution.focus}
              </div>
            </div>
          </div>

          <div className="pt-2">
            <div className="text-xs font-bold uppercase text-[var(--muted)] mb-1.5">
              Themes
            </div>
            <div className="flex flex-wrap gap-1.5">
              {data.themeDistribution.map((t) => (
                <span
                  key={`${t.theme}-${t.variant}`}
                  className="rounded-lg border border-[var(--line)]/40 bg-[var(--surface)] px-2.5 py-1 text-xs font-bold"
                >
                  {t.theme} ({t.variant}): {t.userCount}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* Split Shapes */}
        <section className="card space-y-2.5">
          <h2 className="font-marker text-lg text-[var(--ink)]">
            Split Shapes ({data.splitShapes.activeScheduleCount} active splits)
          </h2>
          <p className="text-sm">
            Avg exercises per training day:{' '}
            <strong>{data.splitShapes.avgExercisesPerTrainingDay}</strong>
          </p>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <div className="font-bold uppercase text-[var(--muted)] mb-1">
                Cycle Length (Days)
              </div>
              {data.splitShapes.daysPerWeekDistribution.length === 0 ? (
                <p className="text-[var(--muted)]">None</p>
              ) : (
                <ul className="space-y-1">
                  {data.splitShapes.daysPerWeekDistribution.map((d) => (
                    <li key={d.cycleLength} className="font-mono">
                      {d.cycleLength}d cycle: {d.userCount} user(s)
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <div className="font-bold uppercase text-[var(--muted)] mb-1">
                Rest Patterns (T=Train, R=Rest)
              </div>
              {data.splitShapes.restDayPatterns.length === 0 ? (
                <p className="text-[var(--muted)]">None</p>
              ) : (
                <ul className="space-y-1">
                  {data.splitShapes.restDayPatterns.slice(0, 8).map((p) => (
                    <li key={p.pattern} className="font-mono">
                      {p.pattern}: {p.userCount}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      </div>

      {/* Exercise Catalog Usage */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="card space-y-2.5">
          <h2 className="font-marker text-lg text-[var(--ink)]">
            Most Logged Catalog Exercises
          </h2>
          {data.catalogUsage.mostLogged.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No logged exercises yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {data.catalogUsage.mostLogged.map((ex) => (
                <li
                  key={ex.exerciseId}
                  className="flex items-center justify-between border-b border-[var(--line)]/15 py-1"
                >
                  <span>{ex.name}</span>
                  <span className="font-mono text-xs text-[var(--muted)]">
                    {ex.logCount} logs · {ex.userCount} users
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card space-y-2.5">
          <h2 className="font-marker text-lg text-[var(--ink)]">
            Least Logged Catalog Exercises
          </h2>
          {data.catalogUsage.leastLogged.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No logged exercises yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {data.catalogUsage.leastLogged.map((ex) => (
                <li
                  key={ex.exerciseId}
                  className="flex items-center justify-between border-b border-[var(--line)]/15 py-1"
                >
                  <span>{ex.name}</span>
                  <span className="font-mono text-xs text-[var(--muted)]">
                    {ex.logCount} logs · {ex.userCount} users
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card space-y-2.5">
          <h2 className="font-marker text-lg text-[var(--ink)]">
            Common Custom Exercises (Catalog Candidates)
          </h2>
          {data.catalogUsage.customExerciseCandidates.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              No custom exercises created yet.
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {data.catalogUsage.customExerciseCandidates.map((c) => (
                <li
                  key={c.normalizedName}
                  className="flex items-center justify-between border-b border-[var(--line)]/15 py-1"
                >
                  <span className="font-bold">{c.sampleName}</span>
                  <span className="font-mono text-xs text-[var(--muted)]">
                    {c.userCount} user(s) · {c.sessionCount} session(s)
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card space-y-2.5">
          <h2 className="font-marker text-lg text-[var(--ink)]">
            Unused Catalog Entries ({data.catalogUsage.unusedCatalogCount})
          </h2>
          <div className="max-h-64 overflow-y-auto flex flex-wrap gap-1.5">
            {data.catalogUsage.unusedCatalog.map((ex) => (
              <span
                key={ex.exerciseId}
                className="rounded-lg border border-[var(--line)]/30 bg-[var(--surface)] px-2 py-0.5 text-xs"
              >
                {ex.name}
              </span>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
