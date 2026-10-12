'use client';

import { useRef, useState } from 'react';
import { Input } from '@/components/ui/input';

export function OtpCodeInput({ value, onChange, disabled, invalid }: { value: string; onChange: (value: string) => void; disabled?: boolean; invalid?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  return <div className="auth-otp-field" data-focused={focused || undefined} data-invalid={invalid || undefined}>
    <Input ref={input} className="auth-otp-input" name="code" aria-label="Six-digit sign-in code" aria-describedby="auth-code-help auth-feedback" aria-invalid={invalid || undefined} type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={value} disabled={disabled} autoFocus onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onChange={event => onChange(event.target.value.replace(/\D/g, '').slice(0, 6))} onPaste={event => { event.preventDefault(); onChange(event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)); }} />
    <div className="auth-code-boxes" aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <span key={index} data-active={focused && index === Math.min(value.length, 5) || undefined}>{value[index] ?? ''}</span>)}</div>
  </div>;
}
