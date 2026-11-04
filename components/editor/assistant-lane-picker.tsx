'use client';

import { useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { LANE_OPTIONS } from '@/lib/ai/lanes/options';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useState } from 'react';
import { userError } from '@/lib/user-error';

/** The active timeline's lane; selecting it also pins routing for follow-up requests. */
export function AssistantLanePicker({
  projectId,
  timelineId,
  disabled,
}: {
  projectId: Id<'projects'>;
  timelineId?: string;
  disabled: boolean;
}) {
  const state = useQuery(api.lanes.current, {
    projectId,
    ...(timelineId ? { timelineId } : {}),
  });
  const choose = useMutation(api.lanes.choose);
  const [error, setError] = useState(''),
    [saving, setSaving] = useState(false);
  const options = LANE_OPTIONS.filter(
    (lane) =>
      lane.id !== 'recreate' ||
      process.env.NODE_ENV === 'development' ||
      state?.internalDetailsEnabled,
  );
  const lane = state?.lane ?? 'edit',
    visible = options.some((option) => option.id === lane);
  return (
    <div className="assistant-lane-picker">
      <Select
        value={visible ? lane : 'auto'}
        disabled={disabled || saving || !state}
        onValueChange={async (value) => {
          if (!state) return;
          const selected = value === 'auto' ? 'edit' : options.find(option => option.id === value)?.id;
          if (!selected) return;
          setSaving(true);
          setError('');
          try {
            await choose({
              projectId,
              timelineId: state.timelineId,
              lane: selected,
            });
          } catch (error) {
            setError(userError(error));
          } finally {
            setSaving(false);
          }
        }}
      >
        <SelectTrigger
          size="sm"
          aria-label="Editing style"
          title={error || state?.reason}
          className="h-7 gap-1.5 border-0 bg-transparent px-2 text-xs text-muted-foreground shadow-none outline-none hover:bg-white/[0.07] focus:ring-0 dark:bg-transparent"
        >
          <SelectValue placeholder="Style (optional)" />
        </SelectTrigger>
        <SelectContent className="bg-[#2a2a2a]">
          <SelectItem value="auto" className="text-xs">Auto</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id} className="text-xs">
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}
