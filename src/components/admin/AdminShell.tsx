'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Activity,
  ArrowLeft,
  BarChart3,
  FileText,
  HardDrive,
  HeartPulse,
  ShieldCheck,
} from 'lucide-react';
import { ChangePasswordGate } from '@/components/shell/ChangePasswordGate';
import { applyThemeToDocument } from '@/lib/theme';
import type { UserProfile } from '@/types/domain';

const ADMIN_NAV = [
  { href: '/admin', label: 'Overview', icon: BarChart3, exact: true },
  { href: '/admin/storage', label: 'Storage & Users', icon: HardDrive, exact: false },
  { href: '/admin/adoption', label: 'Adoption', icon: Activity, exact: false },
  { href: '/admin/health', label: 'Health', icon: HeartPulse, exact: false },
  { href: '/admin/audit', label: 'Audit Log', icon: FileText, exact: false },
] as const;

export function AdminShell({
  adminUser: initialAdminUser,
  children,
}: {
  adminUser: UserProfile;
  children: React.ReactNode;
}) {
  const pathname = usePathname() || '/admin';
  const router = useRouter();
  const [adminUser, setAdminUser] = useState<UserProfile>(initialAdminUser);

  useEffect(() => {
    applyThemeToDocument(adminUser.theme, adminUser.themeVariant);
  }, [adminUser.theme, adminUser.themeVariant]);

  if (adminUser.mustChangePassword) {
    return (
      <ChangePasswordGate
        user={adminUser}
        onPasswordChanged={(updated) => setAdminUser(updated)}
        onLogout={() => router.replace('/welcome')}
      />
    );
  }

  return (
    <div className="min-h-dvh flex flex-col">
      <header
        className="sticky top-0 z-30 border-b-[3px] border-[var(--line)] bg-[var(--paper)]/95 backdrop-blur-md"
        style={{ paddingTop: 'var(--sat)' }}
      >
        <div className="mx-auto flex max-w-5xl flex-col gap-2 px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Link
                href="/admin"
                className="flex items-center gap-1.5 font-marker text-lg text-[var(--ink)] no-underline"
              >
                <ShieldCheck className="h-5 w-5 text-[var(--red)] shrink-0" />
                <span className="truncate">LIFTITUP ADMIN</span>
              </Link>
              <span className="pill gold text-xs shrink-0">
                @{adminUser.username}
              </span>
            </div>

            <Link
              href="/"
              className="btn alt !min-h-[44px] !px-3 text-sm no-underline shrink-0"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>App</span>
            </Link>
          </div>

          <nav
            aria-label="Admin sections"
            className="flex items-center gap-1.5 overflow-x-auto pb-0.5"
          >
            {ADMIN_NAV.map((item) => {
              const Icon = item.icon;
              const active = item.exact
                ? pathname === item.href
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-xl border-2 border-[var(--line)] px-3 text-sm font-bold no-underline transition ${
                    active
                      ? 'bg-[var(--gold)] text-[var(--btn-gold-fg)] shadow-[2px_2px_0_var(--shadow-color)]'
                      : 'bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--surface-alt)]'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-3 py-4 pb-12">
        {children}
      </main>
    </div>
  );
}
