import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  getPointerForDate,
  projectCalendar,
  remapPointerAfterEdit,
  type QueueDay,
  type QueueEvent,
  type QueueSession,
} from '../queue.ts';

// Standard 6-day queue from docs/ARCHITECTURE_PLAN.md §4 worked examples:
// Q = [Push1(0), Pull1(1), Legs1(2), Rest(3), Push2(4), Legs2(5)]
const STD_QUEUE: QueueDay[] = [
  { id: 'd-push1', position: 0, label: 'Push1', isRestDay: false },
  { id: 'd-pull1', position: 1, label: 'Pull1', isRestDay: false },
  { id: 'd-legs1', position: 2, label: 'Legs1', isRestDay: false },
  { id: 'd-rest', position: 3, label: 'Rest', isRestDay: true },
  { id: 'd-push2', position: 4, label: 'Push2', isRestDay: false },
  { id: 'd-legs2', position: 5, label: 'Legs2', isRestDay: false },
];

function makeSession(
  overrides: Partial<QueueSession> & { id: string; sessionDate: string }
): QueueSession {
  return {
    scheduleDayId: null,
    isJolly: false,
    jollyMode: null,
    title: 'Workout',
    completedAt: `${overrides.sessionDate}T18:00:00Z`,
    ...overrides,
  };
}

describe('projectCalendar — §4 Worked Examples', () => {
  it('Example 1: Normal week (no misses)', () => {
    // Anchored Fri 2026-11-06 = 0, today = Mon 2026-11-09
    const days = projectCalendar({
      queue: STD_QUEUE,
      anchorDate: '2026-11-06',
      anchorIndex: 0,
      events: [],
      sessions: [
        makeSession({
          id: 's1',
          sessionDate: '2026-11-06',
          scheduleDayId: 'd-push1',
          title: 'Push1',
        }),
        makeSession({
          id: 's2',
          sessionDate: '2026-11-07',
          scheduleDayId: 'd-pull1',
          title: 'Pull1',
        }),
        makeSession({
          id: 's3',
          sessionDate: '2026-11-08',
          scheduleDayId: 'd-legs1',
          title: 'Legs1',
        }),
      ],
      today: '2026-11-09',
      rangeStart: '2026-11-06',
      rangeEnd: '2026-11-12',
    });

    assert.deepEqual(
      days.map((d) => [d.date, d.status, d.plannedDay?.label ?? null]),
      [
        ['2026-11-06', 'completed', 'Push1'],
        ['2026-11-07', 'completed', 'Pull1'],
        ['2026-11-08', 'completed', 'Legs1'],
        ['2026-11-09', 'rest', 'Rest'],
        ['2026-11-10', 'planned', 'Push2'],
        ['2026-11-11', 'planned', 'Legs2'],
        ['2026-11-12', 'planned', 'Push1'],
      ]
    );
  });

  it('Example 2: Missed Sunday Legs -> Legs Monday, sequence continues without breaking Rest', () => {
    // Anchored Fri 2026-11-06 = 0, today = Mon 2026-11-09
    const days = projectCalendar({
      queue: STD_QUEUE,
      anchorDate: '2026-11-06',
      anchorIndex: 0,
      events: [],
      sessions: [
        makeSession({
          id: 's1',
          sessionDate: '2026-11-06',
          scheduleDayId: 'd-push1',
          title: 'Push1',
        }),
        makeSession({
          id: 's2',
          sessionDate: '2026-11-07',
          scheduleDayId: 'd-pull1',
          title: 'Pull1',
        }),
      ],
      today: '2026-11-09',
      rangeStart: '2026-11-06',
      rangeEnd: '2026-11-12',
    });

    assert.deepEqual(
      days.map((d) => [d.date, d.status, d.plannedDay?.label ?? null]),
      [
        ['2026-11-06', 'completed', 'Push1'],
        ['2026-11-07', 'completed', 'Pull1'],
        ['2026-11-08', 'skipped', 'Legs1'],
        ['2026-11-09', 'planned', 'Legs1'],
        ['2026-11-10', 'rest', 'Rest'],
        ['2026-11-11', 'planned', 'Push2'],
        ['2026-11-12', 'planned', 'Legs2'],
      ]
    );
  });

  it('Example 3: Postpone +1d, +2d, +3d on Monday Legs1', () => {
    const baseSessions = [
      makeSession({
        id: 's1',
        sessionDate: '2026-11-06',
        scheduleDayId: 'd-push1',
        title: 'Push1',
      }),
      makeSession({
        id: 's2',
        sessionDate: '2026-11-07',
        scheduleDayId: 'd-pull1',
        title: 'Pull1',
      }),
    ];

    // +2d on Monday (2026-11-09)
    const days2 = projectCalendar({
      queue: STD_QUEUE,
      anchorDate: '2026-11-06',
      anchorIndex: 0,
      events: [
        {
          eventDate: '2026-11-09',
          eventType: 'postpone',
          shiftDays: 2,
        },
      ],
      sessions: baseSessions,
      today: '2026-11-09',
      rangeStart: '2026-11-08',
      rangeEnd: '2026-11-13',
    });

    assert.deepEqual(
      days2.map((d) => [d.date, d.status, d.plannedDay?.label ?? null]),
      [
        ['2026-11-08', 'skipped', 'Legs1'],
        ['2026-11-09', 'postponed', null],
        ['2026-11-10', 'postponed', null],
        ['2026-11-11', 'planned', 'Legs1'],
        ['2026-11-12', 'rest', 'Rest'],
        ['2026-11-13', 'planned', 'Push2'],
      ]
    );

    // +1d and +3d
    const days1 = projectCalendar({
      queue: STD_QUEUE,
      anchorDate: '2026-11-09',
      anchorIndex: 2,
      events: [{ eventDate: '2026-11-09', eventType: 'postpone', shiftDays: 1 }],
      sessions: [],
      today: '2026-11-09',
      rangeStart: '2026-11-09',
      rangeEnd: '2026-11-11',
    });
    assert.deepEqual(
      days1.map((d) => [d.status, d.plannedDay?.label ?? null]),
      [
        ['postponed', null],
        ['planned', 'Legs1'],
        ['rest', 'Rest'],
      ]
    );

    const days3 = projectCalendar({
      queue: STD_QUEUE,
      anchorDate: '2026-11-09',
      anchorIndex: 2,
      events: [{ eventDate: '2026-11-09', eventType: 'postpone', shiftDays: 3 }],
      sessions: [],
      today: '2026-11-09',
      rangeStart: '2026-11-09',
      rangeEnd: '2026-11-13',
    });
    assert.deepEqual(
      days3.map((d) => [d.status, d.plannedDay?.label ?? null]),
      [
        ['postponed', null],
        ['postponed', null],
        ['postponed', null],
        ['planned', 'Legs1'],
        ['rest', 'Rest'],
      ]
    );
  });

  it('Example 4: Explicit Skip vs Jolly Instead vs Jolly Extra on Monday Legs1', () => {
    const common = {
      queue: STD_QUEUE,
      anchorDate: '2026-11-09',
      anchorIndex: 2, // Legs1
      sessions: [] as QueueSession[],
      today: '2026-11-09',
      rangeStart: '2026-11-09',
      rangeEnd: '2026-11-12',
    };

    // 4a: Explicit Skip
    const skipped = projectCalendar({
      ...common,
      events: [{ eventDate: '2026-11-09', eventType: 'skip' }],
    });
    assert.deepEqual(
      skipped.map((d) => [d.status, d.plannedDay?.label ?? null, d.skippedLabel]),
      [
        ['skipped', 'Legs1', 'Legs1'],
        ['rest', 'Rest', null],
        ['planned', 'Push2', null],
        ['planned', 'Legs2', null],
      ]
    );

    // 4b: Jolly Instead (via session or event)
    const jollyInstead = projectCalendar({
      ...common,
      events: [
        {
          eventDate: '2026-11-09',
          eventType: 'jolly_instead',
          jollyLabel: '5k Run',
        },
      ],
    });
    assert.deepEqual(
      jollyInstead.map((d) => [
        d.status,
        d.plannedDay?.label ?? null,
        d.skippedLabel,
      ]),
      [
        ['jolly_instead', 'Legs1', 'Legs1'],
        ['rest', 'Rest', null],
        ['planned', 'Push2', null],
        ['planned', 'Legs2', null],
      ]
    );

    // 4c: Jolly Extra (defers Legs1 to Tuesday)
    const jollyExtra = projectCalendar({
      ...common,
      events: [],
      sessions: [
        makeSession({
          id: 'j1',
          sessionDate: '2026-11-09',
          isJolly: true,
          jollyMode: 'extra',
          title: 'Arms Pump',
        }),
      ],
    });
    assert.deepEqual(
      jollyExtra.map((d) => [d.status, d.plannedDay?.label ?? null]),
      [
        ['jolly_extra', 'Legs1'],
        ['planned', 'Legs1'],
        ['rest', 'Rest'],
        ['planned', 'Push2'],
      ]
    );
  });

  it('Example 5: Reset on Wednesday restarts queue at index 0 while preserving history', () => {
    // Anchor Fri 2026-11-06 = 0, drifted to Legs1 on Wed 2026-11-11, Reset on Wed
    const days = projectCalendar({
      queue: STD_QUEUE,
      anchorDate: '2026-11-06',
      anchorIndex: 0,
      events: [{ eventDate: '2026-11-11', eventType: 'reset' }],
      sessions: [
        makeSession({
          id: 's1',
          sessionDate: '2026-11-06',
          scheduleDayId: 'd-push1',
          title: 'Push1',
        }),
        makeSession({
          id: 's2',
          sessionDate: '2026-11-07',
          scheduleDayId: 'd-pull1',
          title: 'Pull1',
        }),
      ],
      today: '2026-11-11',
      rangeStart: '2026-11-06',
      rangeEnd: '2026-11-14',
    });

    assert.deepEqual(
      days.map((d) => [d.date, d.status, d.plannedDay?.label ?? null]),
      [
        ['2026-11-06', 'completed', 'Push1'],
        ['2026-11-07', 'completed', 'Pull1'],
        ['2026-11-08', 'skipped', 'Legs1'],
        ['2026-11-09', 'idle', null],
        ['2026-11-10', 'idle', null],
        ['2026-11-11', 'planned', 'Push1'],
        ['2026-11-12', 'planned', 'Pull1'],
        ['2026-11-13', 'planned', 'Legs1'],
        ['2026-11-14', 'rest', 'Rest'],
      ]
    );
  });
});

describe('Amendment B Rules & Edge Cases', () => {
  it('B.1: Multiple resets keep all history before and between resets visible', () => {
    const days = projectCalendar({
      queue: STD_QUEUE,
      anchorDate: '2026-11-01',
      anchorIndex: 0,
      events: [
        { eventDate: '2026-11-04', eventType: 'reset' },
        { eventDate: '2026-11-08', eventType: 'reset' },
      ],
      sessions: [
        makeSession({
          id: 's1',
          sessionDate: '2026-11-01',
          scheduleDayId: 'd-push1',
        }),
        makeSession({
          id: 's2',
          sessionDate: '2026-11-04',
          scheduleDayId: 'd-push1',
        }),
        makeSession({
          id: 's3',
          sessionDate: '2026-11-05',
          scheduleDayId: 'd-pull1',
        }),
      ],
      today: '2026-11-08',
      rangeStart: '2026-11-01',
      rangeEnd: '2026-11-10',
    });

    assert.deepEqual(
      days.map((d) => [d.date, d.status, d.plannedDay?.label ?? null]),
      [
        ['2026-11-01', 'completed', 'Push1'],
        ['2026-11-02', 'skipped', 'Pull1'],
        ['2026-11-03', 'idle', null],
        ['2026-11-04', 'completed', 'Push1'], // reset #1 -> Push1 completed
        ['2026-11-05', 'completed', 'Pull1'],
        ['2026-11-06', 'skipped', 'Legs1'],
        ['2026-11-07', 'idle', null],
        ['2026-11-08', 'planned', 'Push1'], // reset #2 -> back to Push1
        ['2026-11-09', 'planned', 'Pull1'],
        ['2026-11-10', 'planned', 'Legs1'],
      ]
    );
  });

  it('B.1 + Postpone: Reset clears leftover postpone carry-over from before reset', () => {
    const days = projectCalendar({
      queue: STD_QUEUE,
      anchorDate: '2026-11-09',
      anchorIndex: 2, // Legs1
      events: [
        { eventDate: '2026-11-09', eventType: 'postpone', shiftDays: 3 },
        { eventDate: '2026-11-10', eventType: 'reset' },
      ],
      sessions: [],
      today: '2026-11-10',
      rangeStart: '2026-11-09',
      rangeEnd: '2026-11-11',
    });

    assert.deepEqual(
      days.map((d) => [d.date, d.status, d.plannedDay?.label ?? null]),
      [
        ['2026-11-09', 'postponed', null],
        ['2026-11-10', 'planned', 'Push1'],
        ['2026-11-11', 'planned', 'Pull1'],
      ]
    );
  });

  it('B.2: Completing a session advances to (position(scheduleDayId) + 1) % N', () => {
    // Queue is at Push1(0), but user logs Push2(4) -> next day should be Legs2(5)!
    const days = projectCalendar({
      queue: STD_QUEUE,
      anchorDate: '2026-11-09',
      anchorIndex: 0,
      events: [],
      sessions: [
        makeSession({
          id: 's1',
          sessionDate: '2026-11-09',
          scheduleDayId: 'd-push2',
          title: 'Push2',
        }),
      ],
      today: '2026-11-10',
      rangeStart: '2026-11-09',
      rangeEnd: '2026-11-12',
    });

    assert.deepEqual(
      days.map((d) => [d.date, d.status, d.plannedDay?.label ?? null]),
      [
        ['2026-11-09', 'completed', 'Push2'],
        ['2026-11-10', 'planned', 'Legs2'],
        ['2026-11-11', 'planned', 'Push1'],
        ['2026-11-12', 'planned', 'Pull1'],
      ]
    );
  });

  it('B.2: Completing a session with null/unknown scheduleDayId falls back to (qIdx + 1) % N', () => {
    const days = projectCalendar({
      queue: STD_QUEUE,
      anchorDate: '2026-11-09',
      anchorIndex: 1, // Pull1
      events: [],
      sessions: [
        makeSession({
          id: 's1',
          sessionDate: '2026-11-09',
          scheduleDayId: 'deleted-day-id',
          title: 'Custom',
        }),
      ],
      today: '2026-11-10',
      rangeStart: '2026-11-09',
      rangeEnd: '2026-11-10',
    });

    assert.deepEqual(
      days.map((d) => [d.status, d.plannedDay?.label ?? null]),
      [
        ['completed', 'Pull1'],
        ['planned', 'Legs1'],
      ]
    );
  });

  it('B.3: Empty-week streaks mark only first missed day skipped and the rest idle', () => {
    // 14 empty past days before today (2026-11-15)
    const days = projectCalendar({
      queue: STD_QUEUE,
      anchorDate: '2026-11-01',
      anchorIndex: 0, // Push1
      events: [],
      sessions: [],
      today: '2026-11-15',
      rangeStart: '2026-11-01',
      rangeEnd: '2026-11-18',
    });

    assert.equal(days[0].status, 'skipped');
    assert.equal(days[0].plannedDay?.label, 'Push1');
    assert.equal(days[0].skippedLabel, 'Push1');

    // Days 1..13 (Nov 2 .. Nov 14) are all idle
    for (let i = 1; i <= 13; i += 1) {
      assert.equal(days[i].status, 'idle', `Expected idle on ${days[i].date}`);
      assert.equal(days[i].plannedDay, null);
    }

    const skipCount = days.filter((d) => d.status === 'skipped').length;
    assert.equal(skipCount, 1);

    // Today (Nov 15) onward projects from Push1
    assert.deepEqual(
      days.slice(14).map((d) => [d.date, d.status, d.plannedDay?.label ?? null]),
      [
        ['2026-11-15', 'planned', 'Push1'],
        ['2026-11-16', 'planned', 'Pull1'],
        ['2026-11-17', 'planned', 'Legs1'],
        ['2026-11-18', 'rest', 'Rest'],
      ]
    );
  });

  it('Postpone overlapping a rest day preserves the rest day and delays queue', () => {
    // Case A: Postpone +2d triggered directly ON a Rest day
    const onRestDay = projectCalendar({
      queue: STD_QUEUE,
      anchorDate: '2026-11-09',
      anchorIndex: 3, // Rest
      events: [{ eventDate: '2026-11-09', eventType: 'postpone', shiftDays: 2 }],
      sessions: [],
      today: '2026-11-09',
      rangeStart: '2026-11-09',
      rangeEnd: '2026-11-13',
    });
    assert.deepEqual(
      onRestDay.map((d) => [d.status, d.plannedDay?.label ?? null]),
      [
        ['postponed', null],
        ['postponed', null],
        ['rest', 'Rest'],
        ['planned', 'Push2'],
        ['planned', 'Legs2'],
      ]
    );

    // Case B: Overlapping postpones (+2d on Mon, +2d on Tue) spanning across when Rest would occur
    const overlapping = projectCalendar({
      queue: STD_QUEUE,
      anchorDate: '2026-11-09',
      anchorIndex: 2, // Legs1, followed by Rest(3)
      events: [
        { eventDate: '2026-11-09', eventType: 'postpone', shiftDays: 2 },
        { eventDate: '2026-11-10', eventType: 'postpone', shiftDays: 2 },
      ],
      sessions: [],
      today: '2026-11-09',
      rangeStart: '2026-11-09',
      rangeEnd: '2026-11-14',
    });
    assert.deepEqual(
      overlapping.map((d) => [d.status, d.plannedDay?.label ?? null]),
      [
        ['postponed', null], // Mon
        ['postponed', null], // Tue
        ['postponed', null], // Wed (from Tue +2d)
        ['planned', 'Legs1'], // Thu
        ['rest', 'Rest'], // Fri
        ['planned', 'Push2'], // Sat
      ]
    );
  });

  it('Jolly extra on a rest day advances past the rest day to the next workout', () => {
    const days = projectCalendar({
      queue: STD_QUEUE,
      anchorDate: '2026-11-09',
      anchorIndex: 3, // Rest
      events: [],
      sessions: [
        makeSession({
          id: 'j1',
          sessionDate: '2026-11-09',
          isJolly: true,
          jollyMode: 'extra',
          title: 'Zone 2 Run',
        }),
      ],
      today: '2026-11-09',
      rangeStart: '2026-11-09',
      rangeEnd: '2026-11-11',
    });

    assert.deepEqual(
      days.map((d) => [d.status, d.plannedDay?.label ?? null]),
      [
        ['jolly_extra', 'Rest'],
        ['planned', 'Push2'],
        ['planned', 'Legs2'],
      ]
    );
  });

  it('Jolly extra + completed planned session on same day keeps status completed and both sessions', () => {
    const days = projectCalendar({
      queue: STD_QUEUE,
      anchorDate: '2026-11-09',
      anchorIndex: 0, // Push1
      events: [],
      sessions: [
        makeSession({
          id: 's1',
          sessionDate: '2026-11-09',
          scheduleDayId: 'd-push1',
          title: 'Push1',
        }),
        makeSession({
          id: 'j1',
          sessionDate: '2026-11-09',
          isJolly: true,
          jollyMode: 'extra',
          title: 'Evening Abs',
        }),
      ],
      today: '2026-11-09',
      rangeStart: '2026-11-09',
      rangeEnd: '2026-11-10',
    });

    assert.equal(days[0].status, 'completed');
    assert.equal(days[0].sessions.length, 2);
    assert.equal(days[1].plannedDay?.label, 'Pull1');
  });

  it('Queue of length 1 handles completed, missed -> skipped -> idle, completed -> skipped again', () => {
    const singleQueue: QueueDay[] = [
      { id: 'd-fb', position: 0, label: 'Full Body', isRestDay: false },
    ];

    const days = projectCalendar({
      queue: singleQueue,
      anchorDate: '2026-11-01',
      anchorIndex: 0,
      events: [],
      sessions: [
        makeSession({
          id: 's1',
          sessionDate: '2026-11-01',
          scheduleDayId: 'd-fb',
          title: 'Full Body',
        }),
        makeSession({
          id: 's2',
          sessionDate: '2026-11-04',
          scheduleDayId: 'd-fb',
          title: 'Full Body',
        }),
      ],
      today: '2026-11-07',
      rangeStart: '2026-11-01',
      rangeEnd: '2026-11-08',
    });

    assert.deepEqual(
      days.map((d) => [d.date, d.status, d.plannedDay?.label ?? null]),
      [
        ['2026-11-01', 'completed', 'Full Body'],
        ['2026-11-02', 'skipped', 'Full Body'], // first miss
        ['2026-11-03', 'idle', null], // consecutive miss
        ['2026-11-04', 'completed', 'Full Body'], // completed resets missed flag
        ['2026-11-05', 'skipped', 'Full Body'], // new occurrence missed!
        ['2026-11-06', 'idle', null], // consecutive miss
        ['2026-11-07', 'planned', 'Full Body'], // today
        ['2026-11-08', 'planned', 'Full Body'], // tomorrow
      ]
    );
  });

  it('B.4: Days before anchorDate display only logged sessions/events and otherwise unscheduled', () => {
    const days = projectCalendar({
      queue: STD_QUEUE,
      anchorDate: '2026-11-10',
      anchorIndex: 2,
      events: [{ eventDate: '2026-11-08', eventType: 'skip' }],
      sessions: [
        makeSession({
          id: 's0',
          sessionDate: '2026-11-07',
          scheduleDayId: 'd-push1',
          title: 'Push1',
        }),
      ],
      today: '2026-11-10',
      rangeStart: '2026-11-06',
      rangeEnd: '2026-11-11',
    });

    assert.deepEqual(
      days.map((d) => [d.date, d.status, d.plannedDay?.label ?? null]),
      [
        ['2026-11-06', 'unscheduled', null],
        ['2026-11-07', 'completed', null],
        ['2026-11-08', 'skipped', null],
        ['2026-11-09', 'unscheduled', null],
        ['2026-11-10', 'planned', 'Legs1'],
        ['2026-11-11', 'rest', 'Rest'],
      ]
    );
  });

  it('B.5: User local today controls skipped/idle vs planned boundary', () => {
    const base = {
      queue: STD_QUEUE,
      anchorDate: '2026-11-08',
      anchorIndex: 0,
      events: [],
      sessions: [],
      rangeStart: '2026-11-08',
      rangeEnd: '2026-11-10',
    };

    const asNov8 = projectCalendar({ ...base, today: '2026-11-08' });
    assert.deepEqual(
      asNov8.map((d) => d.status),
      ['planned', 'planned', 'planned']
    );

    const asNov10 = projectCalendar({ ...base, today: '2026-11-10' });
    assert.deepEqual(
      asNov10.map((d) => d.status),
      ['skipped', 'idle', 'planned']
    );
  });

  it('Incomplete session (completedAt: null) does not advance queue or mark completed', () => {
    const days = projectCalendar({
      queue: STD_QUEUE,
      anchorDate: '2026-11-08',
      anchorIndex: 0,
      events: [],
      sessions: [
        makeSession({
          id: 's-draft',
          sessionDate: '2026-11-08',
          scheduleDayId: 'd-push1',
          completedAt: null,
        }),
      ],
      today: '2026-11-09',
      rangeStart: '2026-11-08',
      rangeEnd: '2026-11-09',
    });

    assert.deepEqual(
      days.map((d) => [d.status, d.plannedDay?.label ?? null]),
      [
        ['skipped', 'Push1'],
        ['planned', 'Push1'],
      ]
    );
  });

  it('Unsorted queue input is sorted by position, empty queue returns unscheduled, invalid date throws', () => {
    const shuffled = [STD_QUEUE[3], STD_QUEUE[0], STD_QUEUE[2], STD_QUEUE[1]];
    const days = projectCalendar({
      queue: shuffled,
      anchorDate: '2026-11-09',
      anchorIndex: 0,
      events: [],
      sessions: [],
      today: '2026-11-09',
      rangeStart: '2026-11-09',
      rangeEnd: '2026-11-12',
    });
    assert.deepEqual(
      days.map((d) => d.plannedDay?.label),
      ['Push1', 'Pull1', 'Legs1', 'Rest']
    );

    const empty = projectCalendar({
      queue: [],
      anchorDate: '2026-11-09',
      anchorIndex: 0,
      events: [],
      sessions: [],
      today: '2026-11-09',
      rangeStart: '2026-11-09',
      rangeEnd: '2026-11-10',
    });
    assert.deepEqual(
      empty.map((d) => d.status),
      ['unscheduled', 'unscheduled']
    );

    assert.throws(() =>
      projectCalendar({
        queue: STD_QUEUE,
        anchorDate: '2026-02-30',
        anchorIndex: 0,
        events: [],
        sessions: [],
        today: '2026-11-09',
        rangeStart: '2026-11-09',
        rangeEnd: '2026-11-10',
      })
    );
  });
});

describe('getPointerForDate & remapPointerAfterEdit — B.4 Re-anchoring', () => {
  it('computes pointer for today and remaps to preserved day ID after reorder/insert', () => {
    // Anchor Fri Nov 6 = 0; Fri Push1 completed, Sat Pull1 completed, Sun Legs1 missed
    // Entering Mon Nov 9 -> pointer is Legs1 (index 2)
    const pointer = getPointerForDate({
      queue: STD_QUEUE,
      anchorDate: '2026-11-06',
      anchorIndex: 0,
      events: [],
      sessions: [
        makeSession({
          id: 's1',
          sessionDate: '2026-11-06',
          scheduleDayId: 'd-push1',
        }),
        makeSession({
          id: 's2',
          sessionDate: '2026-11-07',
          scheduleDayId: 'd-pull1',
        }),
      ],
      today: '2026-11-09',
      targetDate: '2026-11-09',
    });

    assert.deepEqual(pointer, { index: 2, dayId: 'd-legs1' });

    // Edit split: insert 'Core' at position 0, shifting Legs1 to position 3
    const newDays: QueueDay[] = [
      { id: 'd-core', position: 0, label: 'Core', isRestDay: false },
      { id: 'd-push1', position: 1, label: 'Push1', isRestDay: false },
      { id: 'd-pull1', position: 2, label: 'Pull1', isRestDay: false },
      { id: 'd-legs1', position: 3, label: 'Legs1', isRestDay: false },
      { id: 'd-rest', position: 4, label: 'Rest', isRestDay: true },
      { id: 'd-push2', position: 5, label: 'Push2', isRestDay: false },
      { id: 'd-legs2', position: 6, label: 'Legs2', isRestDay: false },
    ];

    const newAnchorIndex = remapPointerAfterEdit(STD_QUEUE, newDays, pointer);
    assert.equal(newAnchorIndex, 3);

    // Re-anchoring at today=2026-11-09 with newAnchorIndex=3 projects Legs1 today
    const reprojected = projectCalendar({
      queue: newDays,
      anchorDate: '2026-11-09',
      anchorIndex: newAnchorIndex,
      events: [],
      sessions: [],
      today: '2026-11-09',
      rangeStart: '2026-11-09',
      rangeEnd: '2026-11-11',
    });
    assert.deepEqual(
      reprojected.map((d) => d.plannedDay?.label),
      ['Legs1', 'Rest', 'Push2']
    );
  });

  it('remapPointerAfterEdit advances to next surviving day when pointed day is deleted', () => {
    // Pointer was on Pull1 (1); user deletes Push1 (0) and Pull1 (1) -> next surviving is Legs1 (now index 0)
    const newDays: QueueDay[] = [
      { id: 'd-legs1', position: 0, label: 'Legs1', isRestDay: false },
      { id: 'd-rest', position: 1, label: 'Rest', isRestDay: true },
      { id: 'd-push2', position: 2, label: 'Push2', isRestDay: false },
    ];
    assert.equal(
      remapPointerAfterEdit(STD_QUEUE, newDays, { index: 1, dayId: 'd-pull1' }),
      0
    );

    // Pointer was on Legs2 (5); user deletes Legs2 -> wraps around to Push1 (0)
    const withoutLegs2 = STD_QUEUE.slice(0, 5);
    assert.equal(remapPointerAfterEdit(STD_QUEUE, withoutLegs2, 5), 0);
  });

  it('remapPointerAfterEdit returns 0 when all day IDs are replaced or newDays is empty', () => {
    const brandNew: QueueDay[] = [
      { id: 'new-1', position: 0, label: 'Upper', isRestDay: false },
      { id: 'new-2', position: 1, label: 'Lower', isRestDay: false },
    ];
    assert.equal(
      remapPointerAfterEdit(STD_QUEUE, brandNew, { index: 2, dayId: 'd-legs1' }),
      0
    );
    assert.equal(remapPointerAfterEdit(STD_QUEUE, [], 2), 0);
  });
});
