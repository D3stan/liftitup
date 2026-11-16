'use client';

import React, { useSyncExternalStore } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

export type ToastVariant = 'info' | 'success' | 'error';

export interface ToastItem {
  id: string;
  message: string;
  variant: ToastVariant;
}

interface ToastOptions {
  variant?: ToastVariant;
  durationMs?: number;
}

let toasts: ToastItem[] = [];
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ToastItem[] {
  return toasts;
}

const SERVER_SNAPSHOT: ToastItem[] = [];
function getServerSnapshot(): ToastItem[] {
  return SERVER_SNAPSHOT;
}

export function dismissToast(id: string): void {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
  const next = toasts.filter((t) => t.id !== id);
  if (next.length !== toasts.length) {
    toasts = next;
    emit();
  }
}

function pushToast(message: string, opts?: ToastOptions): string {
  const id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const variant = opts?.variant ?? 'info';
  const durationMs =
    opts?.durationMs ?? (variant === 'error' ? 4800 : 3200);

  toasts = [...toasts.slice(-3), { id, message, variant }];
  emit();

  if (durationMs > 0) {
    const timer = setTimeout(() => dismissToast(id), durationMs);
    timers.set(id, timer);
  }
  return id;
}

interface ToastFn {
  (message: string, opts?: ToastOptions): string;
  success: (message: string, durationMs?: number) => string;
  error: (message: string, durationMs?: number) => string;
  info: (message: string, durationMs?: number) => string;
}

export const toast: ToastFn = Object.assign(
  (message: string, opts?: ToastOptions) => pushToast(message, opts),
  {
    success: (message: string, durationMs?: number) =>
      pushToast(message, { variant: 'success', durationMs }),
    error: (message: string, durationMs?: number) =>
      pushToast(message, { variant: 'error', durationMs }),
    info: (message: string, durationMs?: number) =>
      pushToast(message, { variant: 'info', durationMs }),
  },
);

const VARIANT_CLASSES: Record<ToastVariant, string> = {
  info: 'bg-[var(--card)] text-[var(--ink)]',
  success: 'bg-[var(--green-bg)] text-[var(--ink)]',
  error: 'bg-[var(--red-bg)] text-[var(--ink)]',
};

export function Toaster() {
  const items = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  if (items.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed left-0 right-0 z-[90] flex flex-col items-center gap-2 px-3"
      style={{ top: 'calc(12px + var(--sat))' }}
    >
      {items.map((item) => {
        const Icon =
          item.variant === 'error'
            ? AlertCircle
            : item.variant === 'success'
              ? CheckCircle2
              : Info;
        return (
          <div
            key={item.id}
            role={item.variant === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex w-full max-w-md items-center gap-2.5 rounded-[8px] border-[3px] border-[var(--line)] px-3.5 py-2.5 shadow-[4px_4px_0_var(--shadow-color)] ${VARIANT_CLASSES[item.variant]}`}
          >
            <Icon className="h-5 w-5 shrink-0" />
            <span className="flex-1 text-base font-bold leading-snug break-words">
              {item.message}
            </span>
            <button
              type="button"
              onClick={() => dismissToast(item.id)}
              aria-label="Dismiss"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border-2 border-transparent hover:border-[var(--line)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
