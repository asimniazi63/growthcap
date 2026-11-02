"use client";

import { Pause, Play, RotateCcw } from "lucide-react";
import { useId, type CSSProperties } from "react";
import type { PlotGeometry } from "@/components/pace/pace-chart";
import type { PaceSeriesDay } from "@/lib/pace/series";

// The replay control under the Pace chart: a slider over the month's complete days, a Play button that walks it forward, and a
// way back to today. The slider sits under the chart's own day axis, so its thumb is under the day it shows. Dragging only moves
// `day`; the parent redraws the chart and the figures from the days up to it.

const longDate = (ymd: string) => new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${ymd}T00:00:00Z`));

const THUMB = 18;
const MIN_ALIGNED = 150; // narrower than this, the slider spans the whole plot instead of just the days that have happened

// A native range input, styled with tokens. The track fills up to the thumb (--fill, set on the input) in the brand colour. The
// class names are written out whole so Tailwind finds them.
const RANGE = [
  "block h-6 w-full cursor-pointer appearance-none bg-transparent",
  "[&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-[linear-gradient(to_right,var(--color-brand)_var(--fill),var(--color-line-strong)_var(--fill))]",
  "[&::-webkit-slider-thumb]:-mt-[7px] [&::-webkit-slider-thumb]:size-[18px] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-[2.5px] [&::-webkit-slider-thumb]:border-solid [&::-webkit-slider-thumb]:border-brand [&::-webkit-slider-thumb]:bg-surface [&::-webkit-slider-thumb]:shadow-card",
  "[&::-moz-range-track]:h-1 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-[linear-gradient(to_right,var(--color-brand)_var(--fill),var(--color-line-strong)_var(--fill))]",
  "[&::-moz-range-thumb]:size-[18px] [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-[2.5px] [&::-moz-range-thumb]:border-solid [&::-moz-range-thumb]:border-brand [&::-moz-range-thumb]:bg-surface [&::-moz-range-thumb]:shadow-card",
].join(" ");

export function PaceScrubber({
  days,
  day,
  last,
  onDay,
  playing,
  onPlaying,
  reducedMotion,
  plot,
}: {
  days: readonly PaceSeriesDay[];
  day: number; // 1-based, the day shown
  last: number; // 1-based, the last complete day (today's view)
  onDay: (day: number) => void;
  playing: boolean;
  onPlaying: (playing: boolean) => void;
  reducedMotion: boolean;
  plot: PlotGeometry;
}) {
  const id = useId();
  const date = days[day - 1]?.date ?? days[last - 1]!.date;
  const atToday = day >= last;

  const x1 = plot.x(1);
  const aligned = plot.x(last) - x1;
  const span = aligned >= MIN_ALIGNED ? aligned : plot.right - x1;
  const box: CSSProperties = {
    marginLeft: `${((x1 - THUMB / 2) / plot.width) * 100}%`,
    width: `${((span + THUMB) / plot.width) * 100}%`,
    ["--fill" as string]: `${last > 1 ? ((day - 1) / (last - 1)) * 100 : 100}%`,
  };

  return (
    <div className="mt-3">
      <input
        id={id}
        type="range"
        min={1}
        max={last}
        step={1}
        value={day}
        aria-label="Replay the month: day to show"
        aria-valuetext={longDate(date)}
        className={RANGE}
        style={box}
        onChange={(e) => {
          onPlaying(false);
          onDay(Number(e.target.value));
        }}
      />
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {reducedMotion ? null : (
          <button
            type="button"
            data-play
            className="btn btn-secondary btn-sm motion-reduce:hidden"
            aria-label={playing ? "Pause the replay" : "Play the month from the start"}
            onClick={() => {
              if (playing) onPlaying(false);
              else {
                if (atToday) onDay(1);
                onPlaying(true);
              }
            }}
          >
            {playing ? <Pause className="size-3.5" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
            {playing ? "Pause" : "Play"}
          </button>
        )}
        <p className="muted order-last w-full text-[13px] sm:order-none sm:w-auto sm:min-w-0 sm:flex-1">
          {atToday ? "Drag the slider to replay the month day by day." : `The month as it stood on ${longDate(date)}. Later days are left out.`}
        </p>
        <button
          type="button"
          className="btn btn-ghost btn-sm ml-auto sm:ml-0"
          disabled={atToday}
          onClick={() => {
            onPlaying(false);
            onDay(last);
          }}
        >
          <RotateCcw className="size-3.5" aria-hidden />
          Back to today
        </button>
      </div>
    </div>
  );
}
