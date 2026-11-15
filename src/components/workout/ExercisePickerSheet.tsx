'use client';

import React, { useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import type { Exercise } from '@/types/domain';
import { Sheet } from '@/components/ui';
import { getTrackingShortLabel } from './trackingFormat';

export interface ExercisePickerSheetProps {
  open: boolean;
  onClose: () => void;
  exercises: Exercise[];
  onSelect: (exercise: Exercise) => void;
}

const CATEGORIES = [
  { id: '', label: 'All' },
  { id: 'push', label: 'Push' },
  { id: 'pull', label: 'Pull' },
  { id: 'legs', label: 'Legs' },
  { id: 'core', label: 'Core' },
  { id: 'cardio', label: 'Cardio' },
  { id: 'skill', label: 'Skill' },
  { id: 'full_body', label: 'Full' },
];

export default function ExercisePickerSheet({
  open,
  onClose,
  exercises,
  onSelect,
}: ExercisePickerSheetProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return exercises.filter((ex) => {
      if (category && ex.category !== category) return false;
      if (!q) return true;
      return (
        ex.name.toLowerCase().includes(q) ||
        ex.aliases.some((a) => a.toLowerCase().includes(q))
      );
    });
  }, [exercises, query, category]);

  return (
    <Sheet open={open} onClose={onClose} title="Add Exercise">
      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#5d5446]" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search catalog & custom..."
            className="min-h-[44px] w-full rounded-[8px] border-[2.5px] border-[#1d1a16] bg-[#fbf5e4] pl-9 pr-3 text-base font-bold outline-none"
          />
        </div>

        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {CATEGORIES.map((c) => (
            <button
              key={c.id || 'all'}
              type="button"
              onClick={() => setCategory(c.id)}
              className={`pill min-h-[36px] shrink-0 cursor-pointer text-xs ${
                category === c.id ? 'gold' : ''
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
          {filtered.slice(0, 80).map((ex) => (
            <button
              key={ex.id}
              type="button"
              onClick={() => {
                onSelect(ex);
                onClose();
              }}
              className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-[8px] border-[2.5px] border-[#1d1a16] bg-[#fbf5e4] px-3 py-2 text-left active:bg-[#fbedba]"
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <Plus className="h-4 w-4 shrink-0 text-[#2e7d3a]" />
                <span className="truncate font-bold text-[#1d1a16]">
                  {ex.name}
                </span>
                {ex.isCustom && (
                  <span className="pill gold shrink-0 py-0 text-[11px]">
                    Custom
                  </span>
                )}
              </div>
              <span className="pill shrink-0 text-xs">
                {getTrackingShortLabel(ex.trackingType)}
              </span>
            </button>
          ))}

          {filtered.length === 0 && (
            <p className="py-6 text-center text-base font-bold text-[#5d5446]">
              No exercises found
            </p>
          )}
        </div>
      </div>
    </Sheet>
  );
}
