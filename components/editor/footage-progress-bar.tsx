'use client';

import { Progress } from '@/components/ui/progress';
import { useFootageProgress } from '@/lib/editor/footage-progress-store';

export function FootageProgressBar({ progressKey, value, label }: { progressKey: string; value: number; label: string }) {
  const progress = useFootageProgress(progressKey, value);
  return <Progress aria-label={label} max={100} value={progress}/>;
}
