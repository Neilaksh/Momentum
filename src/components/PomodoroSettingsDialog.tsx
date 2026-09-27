import { useEffect, useState } from "react";
import { Clock, Coffee, RefreshCw, Timer } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DEFAULT_POMODORO_SETTINGS,
  POMODORO_LIMITS,
  type PomodoroSettings,
} from "@/lib/pomodoro-shared";

interface PomodoroSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: PomodoroSettings;
  onChange: (patch: Partial<PomodoroSettings>) => void;
  onResetSettings: () => void;
  onResetCycle: () => void;
}

interface NumberFieldProps {
  id: string;
  label: string;
  hint: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  presets: number[];
  presetLabel: (value: number) => string;
  onCommit: (value: number) => void;
}

/**
 * One cycle length. The field keeps its own text so it can be cleared and retyped
 * - the committed value stays the truth - and out-of-range entries clamp to the
 * allowed window instead of being rejected.
 */
function NumberField({
  id,
  label,
  hint,
  unit,
  value,
  min,
  max,
  presets,
  presetLabel,
  onCommit,
}: NumberFieldProps) {
  const [text, setText] = useState(String(value));

  useEffect(() => {
    setText(String(value));
  }, [value]);

  const commit = (raw: string) => {
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return;
    onCommit(Math.min(max, Math.max(min, parsed)));
  };

  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-sm">
        {label}
      </Label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          enterKeyHint="done"
          min={min}
          max={max}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            commit(e.target.value);
          }}
          onBlur={() => setText(String(value))}
          className="h-9 w-24"
        />
        <span className="text-xs text-muted-foreground">{unit}</span>
        {presets.map((preset) => (
          <Button
            key={preset}
            type="button"
            size="sm"
            variant={value === preset ? "default" : "outline"}
            className="h-8 px-2.5 text-xs"
            onClick={() => {
              setText(String(preset));
              onCommit(preset);
            }}
          >
            {presetLabel(preset)}
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
interface ToggleRowProps {
  label: string;
  hint: string;
  checked: boolean;
  onToggle: () => void;
}

/** On/off row. The app has no Switch in use, so this mirrors the mode pills. */
function ToggleRow({ label, hint, checked, onToggle }: ToggleRowProps) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-border bg-muted/30 p-3">
      <div className="space-y-0.5">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Button
        type="button"
        size="sm"
        variant={checked ? "default" : "outline"}
        aria-pressed={checked}
        className="shrink-0"
        onClick={onToggle}
      >
        {checked ? "On" : "Off"}
      </Button>
    </div>
  );
}

export function PomodoroSettingsDialog({
  open,
  onOpenChange,
  settings,
  onChange,
  onResetSettings,
  onResetCycle,
}: PomodoroSettingsDialogProps) {
  const limits = POMODORO_LIMITS;
  const defaults = DEFAULT_POMODORO_SETTINGS;
  const minutePresetLabel = (value: number) => `${value}m`;
  const classicLabel = `Classic ${defaults.focusMinutes}/${defaults.shortBreakMinutes}/${defaults.longBreakMinutes}`;
  const cycleMinutes =
    settings.longBreakAfter * settings.focusMinutes +
    (settings.longBreakAfter - 1) * settings.shortBreakMinutes +
    settings.longBreakMinutes;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Pomodoro settings</DialogTitle>
          <DialogDescription>
            Set the focus block and the breaks that follow it. Only focus time reaches your study
            history, so breaks never inflate your totals.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <NumberField
              id="pomodoro-focus"
              label="Focus block"
              hint="How long one pomodoro lasts."
              unit="min"
              value={settings.focusMinutes}
              min={limits.focusMinutes.min}
              max={limits.focusMinutes.max}
              presets={[15, 25, 45, 50]}
              presetLabel={minutePresetLabel}
              onCommit={(focusMinutes) => onChange({ focusMinutes })}
            />
            <NumberField
              id="pomodoro-short-break"
              label="Short break"
              hint="Rest after every focus block."
              unit="min"
              value={settings.shortBreakMinutes}
              min={limits.shortBreakMinutes.min}
              max={limits.shortBreakMinutes.max}
              presets={[3, 5, 10]}
              presetLabel={minutePresetLabel}
              onCommit={(shortBreakMinutes) => onChange({ shortBreakMinutes })}
            />
            <NumberField
              id="pomodoro-long-break"
              label="Long break"
              hint="The longer rest once a cycle is complete."
              unit="min"
              value={settings.longBreakMinutes}
              min={limits.longBreakMinutes.min}
              max={limits.longBreakMinutes.max}
              presets={[10, 15, 20, 30]}
              presetLabel={minutePresetLabel}
              onCommit={(longBreakMinutes) => onChange({ longBreakMinutes })}
            />
            <NumberField
              id="pomodoro-long-after"
              label="Long break after"
              hint="Replaces the short break every Nth pomodoro."
              unit="pomodoros"
              value={settings.longBreakAfter}
              min={limits.longBreakAfter.min}
              max={limits.longBreakAfter.max}
              presets={[2, 4, 6]}
              presetLabel={(value) => `${value}x`}
              onCommit={(longBreakAfter) => onChange({ longBreakAfter })}
            />
          </div>

          <div className="space-y-2">
            <ToggleRow
              label="Auto-start breaks"
              hint="Roll into the break the moment a focus block ends."
              checked={settings.autoStartBreaks}
              onToggle={() => onChange({ autoStartBreaks: !settings.autoStartBreaks })}
            />
            <ToggleRow
              label="Auto-start next focus"
              hint="Begin the next pomodoro as soon as a break ends."
              checked={settings.autoStartFocus}
              onToggle={() => onChange({ autoStartFocus: !settings.autoStartFocus })}
            />
            <ToggleRow
              label="Chime at the end of a phase"
              hint="A short two-tone tone when focus or a break ends."
              checked={settings.soundEnabled}
              onToggle={() => onChange({ soundEnabled: !settings.soundEnabled })}
            />
          </div>

          <div className="rounded-xl border border-border bg-muted/40 p-4">
            <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
              <Timer className="h-4 w-4 text-primary" />
              {settings.focusMinutes} min focus
              <Coffee className="h-4 w-4 text-primary" />
              {settings.shortBreakMinutes} min break
              <Clock className="h-4 w-4 text-primary" />
              {settings.longBreakMinutes} min every {settings.longBreakAfter}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              A full cycle is {settings.longBreakAfter} pomodoros plus breaks, about {cycleMinutes}{" "}
              minutes.
            </p>
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={onResetSettings}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {classicLabel}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onResetCycle}>
              Reset cycle count
            </Button>
          </div>
          <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
