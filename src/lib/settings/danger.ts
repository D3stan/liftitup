export type DangerAction =
  | 'delete_workouts'
  | 'delete_body'
  | 'reset_split'
  | 'delete_account';

export interface DangerActionMeta {
  id: DangerAction;
  title: string;
  description: string;
  removes: string;
  keeps: string;
  confirmationWord: string;
  buttonLabel: string;
}

export const DANGER_ACTIONS: DangerActionMeta[] = [
  {
    id: 'delete_workouts',
    title: 'Delete all workout history',
    description: 'Erase every logged session, set, and rep quality.',
    removes:
      'All workout sessions with their exercises, sets, and rep qualities; session swaps; Apple Health workout links to those sessions.',
    keeps:
      'Your split, custom exercises, body data, and Apple Health workouts themselves.',
    confirmationWord: 'DELETE',
    buttonLabel: 'Delete workout history',
  },
  {
    id: 'delete_body',
    title: 'Delete all body data',
    description: 'Erase body metric history and reset profile weight.',
    removes:
      'All recorded body metrics and resets your profile weight to the default (75 kg).',
    keeps:
      'Workout history, split, custom exercises, and Apple Health workouts.',
    confirmationWord: 'DELETE',
    buttonLabel: 'Delete body data',
  },
  {
    id: 'reset_split',
    title: 'Reset split',
    description: 'Remove all schedules, training days, and schedule events.',
    removes:
      'All schedules (active and inactive), their days, day exercises, and schedule events.',
    keeps:
      'Logged workout sessions (unlinked from your split) and all exercises.',
    confirmationWord: 'RESET',
    buttonLabel: 'Reset split',
  },
  {
    id: 'delete_account',
    title: 'Delete account',
    description: 'Permanently delete your account and all data.',
    removes:
      'Everything belonging to your account (workouts, split, body data, custom exercises, Apple Health workouts, API key, and sessions), then logs you out.',
    keeps: 'Nothing.',
    confirmationWord: 'DELETE',
    buttonLabel: 'Delete account',
  },
];

export const DANGER_ACTION_MAP: Record<DangerAction, DangerActionMeta> =
  Object.fromEntries(DANGER_ACTIONS.map((a) => [a.id, a])) as Record<
    DangerAction,
    DangerActionMeta
  >;

export function isDangerAction(value: unknown): value is DangerAction {
  return (
    value === 'delete_workouts' ||
    value === 'delete_body' ||
    value === 'reset_split' ||
    value === 'delete_account'
  );
}
