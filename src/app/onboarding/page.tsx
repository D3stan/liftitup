'use client';

import React from 'react';
import Link from 'next/link';
import { CalendarDays, Cpu } from 'lucide-react';

export default function OnboardingPage() {
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-md space-y-5">
        <div className="text-center space-y-1">
          <div className="brand text-3xl">LIFTITUP</div>
          <h1 className="font-marker text-2xl text-[var(--ink)]">
            Setup your plan
          </h1>
        </div>

        <div className="space-y-3">
          <Link
            href="/ai"
            className="hero-card flex items-center justify-between gap-3 no-underline text-[var(--btn-gold-fg)]"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px] border-[3px] border-[var(--line)] bg-[var(--card)] text-[var(--ink)]">
                <Cpu className="h-6 w-6" />
              </div>
              <div>
                <div className="font-marker text-xl">AI onboarding</div>
                <div className="text-sm font-bold opacity-80">
                  Import from AI chat
                </div>
              </div>
            </div>
            <span className="pill bg-[var(--card)] text-[var(--ink)]">Go</span>
          </Link>

          <Link
            href="/"
            className="card flex items-center justify-between gap-3 no-underline text-[var(--ink)]"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px] border-[3px] border-[var(--line)] bg-[var(--paper)]">
                <CalendarDays className="h-6 w-6" />
              </div>
              <div>
                <div className="font-marker text-xl">Empty setup</div>
                <div className="text-sm font-bold text-[var(--muted)]">
                  Start blank
                </div>
              </div>
            </div>
            <span className="pill">Go</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
