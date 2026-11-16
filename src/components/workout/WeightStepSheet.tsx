'use client';

import React, { useState } from 'react';
import type { WeightUnit } from '@/types/domain';
import { Button, Sheet } from '@/components/ui';
import {
  displayStepToKg,
  KG_WEIGHT_STEP_OPTIONS,
  LB_WEIGHT_STEP_OPTIONS,
  type WeightStepSource,
} from '@/lib/workouts/stepSize';

const STEP_SOURCE_LABEL: Record<WeightStepSource, string> = {
  override: 'Personal override for this exercise',
  exercise: 'Exercise default step',
  global: 'Your Training default step',
  default: 'App default step',
};

export interface WeightStepSheetProps {
  open: boolean;
  onClose: () => void;
  exerciseId: string;
  exerciseName: string;
  unit: WeightUnit;
  effectiveWeightStep: number;
  weightStepSource: WeightStepSource;
  isCustomExercise: boolean;
  canResetStep: boolean;
  onChangeWeightStep: (
    exerciseId: string,
    weightStepKg: number | null,
  ) => Promise<void>;
}

export default function WeightStepSheet({
  open,
  onClose,
  exerciseId,
  exerciseName,
  unit,
  effectiveWeightStep,
  weightStepSource,
  isCustomExercise,
  canResetStep,
  onChangeWeightStep,
}: WeightStepSheetProps) {
  const [savingStep, setSavingStep] = useState(false);
  const weightStepOptions =
    unit === 'lb' ? LB_WEIGHT_STEP_OPTIONS : KG_WEIGHT_STEP_OPTIONS;

  const handleSelectWeightStep = async (nextStepKg: number | null) => {
    if (savingStep) return;
    setSavingStep(true);
    try {
      await onChangeWeightStep(exerciseId, nextStepKg);
      onClose();
    } finally {
      setSavingStep(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Weight Step">
      <div className="space-y-3">
        <div>
          <p className="font-bold text-[var(--ink)]">{exerciseName}</p>
          <p className="text-sm text-[var(--muted)]">
            {isCustomExercise && weightStepSource === 'exercise'
              ? 'Custom exercise step'
              : STEP_SOURCE_LABEL[weightStepSource]}
            :{' '}
            <strong>
              ±{effectiveWeightStep} {unit}
            </strong>
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {weightStepOptions.map((option) => {
            const selected = effectiveWeightStep === option;
            return (
              <button
                key={option}
                type="button"
                disabled={savingStep}
                onClick={() =>
                  void handleSelectWeightStep(displayStepToKg(option, unit))
                }
                className={`min-h-[44px] min-w-[72px] rounded-xl border-[2.5px] border-[var(--line)] px-3 text-sm font-bold shadow-[2px_2px_0_var(--shadow-color)] ${
                  selected
                    ? 'bg-[var(--gold)] text-[var(--btn-gold-fg)]'
                    : 'bg-[var(--card)] text-[var(--ink)]'
                }`}
              >
                ±{option} {unit}
              </button>
            );
          })}
        </div>

        {canResetStep && (
          <Button
            variant="alt"
            loading={savingStep}
            onClick={() => void handleSelectWeightStep(null)}
            className="w-full"
          >
            Reset to default
          </Button>
        )}
      </div>
    </Sheet>
  );
}
