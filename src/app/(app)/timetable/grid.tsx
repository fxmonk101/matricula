'use client';

import { useMemo, useState } from 'react';

import {
  DAYS,
  DAY_SHORT,
  GRID_END_MINUTE,
  GRID_START_MINUTE,
  layOutDay,
  type Clash,
  type DayOfWeek,
  type ScheduledSlot,
} from '@/lib/domain/timetable';
import { formatMinutes } from '@/lib/utils';

/**
 * The weekly grid.
 *
 * Overlapping classes are laid out SIDE BY SIDE rather than stacked. A clash
 * the eye cannot see is a clash nobody fixes, and finding them is the whole
 * reason a dean opens this page — so the layout has to make a double-booking
 * look wrong rather than look like one class.
 */
export function TimetableGrid({
  slots,
  clashes,
  onPick,
}: {
  slots: ScheduledSlot[];
  clashes: Clash[];
  onPick?: (slot: ScheduledSlot) => void;
}) {
  const [focus, setFocus] = useState<string | null>(null);

  // Ids involved in a clash, so the grid can mark them without re-running the
  // detector per cell.
  const clashing = useMemo(() => {
    const ids = new Set<string>();
    for (const c of clashes) {
      ids.add(c.a.id);
      ids.add(c.b.id);
    }
    return ids;
  }, [clashes]);

  const hours: number[] = [];
  for (let m = GRID_START_MINUTE; m <= GRID_END_MINUTE; m += 60) hours.push(m);

  // Saturday and Sunday only appear when something is actually timetabled on
  // them — most universities would otherwise carry two empty columns forever.
  const activeDays = DAYS.filter(
    (d) => d <= 5 || slots.some((s) => s.dayOfWeek === d),
  );

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[46rem]">
        <div
          className="grid border-b border-slate-200"
          style={{ gridTemplateColumns: `3.5rem repeat(${activeDays.length}, minmax(0, 1fr))` }}
        >
          <div />
          {activeDays.map((day) => (
            <div
              key={day}
              className="border-l border-slate-200 px-2 py-2 text-center text-xs font-semibold text-slate-700"
            >
              {DAY_SHORT[day as DayOfWeek]}
            </div>
          ))}
        </div>

        <div
          className="relative grid"
          style={{
            gridTemplateColumns: `3.5rem repeat(${activeDays.length}, minmax(0, 1fr))`,
            height: '34rem',
          }}
        >
          {/* The hour rail. */}
          <div className="relative">
            {hours.map((m) => (
              <div
                key={m}
                className="absolute right-1 -translate-y-1/2 text-[10px] tabular-nums text-slate-400"
                style={{
                  top: `${((m - GRID_START_MINUTE) / (GRID_END_MINUTE - GRID_START_MINUTE)) * 100}%`,
                }}
              >
                {formatMinutes(m)}
              </div>
            ))}
          </div>

          {activeDays.map((day) => {
            const positioned = layOutDay(slots.filter((s) => s.dayOfWeek === day));
            return (
              <div key={day} className="relative border-l border-slate-200">
                {hours.map((m) => (
                  <div
                    key={m}
                    className="absolute inset-x-0 border-t border-slate-100"
                    style={{
                      top: `${((m - GRID_START_MINUTE) / (GRID_END_MINUTE - GRID_START_MINUTE)) * 100}%`,
                    }}
                  />
                ))}

                {positioned.map((slot) => {
                  const bad = clashing.has(slot.id);
                  const width = 100 / slot.columns;
                  return (
                    <button
                      key={slot.id}
                      type="button"
                      onClick={() => {
                        setFocus(slot.id);
                        onPick?.(slot);
                      }}
                      onMouseEnter={() => setFocus(slot.id)}
                      onMouseLeave={() => setFocus(null)}
                      title={`${slot.offeringLabel} · ${formatMinutes(slot.startMinute)}–${formatMinutes(slot.endMinute)}${slot.room ? ` · ${slot.room}` : ''}${slot.teacherName ? ` · ${slot.teacherName}` : ''}`}
                      className={[
                        'absolute overflow-hidden rounded-md px-1.5 py-1 text-left text-[10px] leading-tight ring-1 transition',
                        bad
                          ? 'bg-rose-50 text-rose-900 ring-rose-300 hover:bg-rose-100'
                          : 'bg-brand-50 text-brand-900 ring-brand-200 hover:bg-brand-100',
                        focus === slot.id ? 'z-20 shadow-md' : 'z-10',
                      ].join(' ')}
                      style={{
                        top: `${slot.top}%`,
                        height: `${Math.max(slot.height, 3)}%`,
                        left: `calc(${slot.column * width}% + 2px)`,
                        width: `calc(${width}% - 4px)`,
                      }}
                    >
                      <span className="block truncate font-semibold">{slot.offeringLabel}</span>
                      <span className="block truncate opacity-75">
                        {formatMinutes(slot.startMinute)}
                        {slot.room ? ` · ${slot.room}` : ''}
                      </span>
                      {bad && <span className="block truncate font-medium">clash</span>}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
