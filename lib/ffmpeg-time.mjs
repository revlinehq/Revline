// FFmpeg parses time options (-ss, -t, -to, -itsoffset) as plain decimals and
// rejects JavaScript's exponent form (`String(3.3e-7)` is "3.3e-7"). Every time
// value handed to FFmpeg goes through this formatter: fixed microseconds, no
// exponent, trailing zeros trimmed, and no "-0".

/**
 * @param {number} seconds
 * @returns {string}
 */
export function ffmpegTime(seconds) {
  // toFixed itself switches to exponent form from 1e21; no real time gets near that.
  if (!Number.isFinite(seconds) || Math.abs(seconds) >= 1e15) throw new Error(`FFmpeg time is out of range: ${seconds}`);
  const text = seconds.toFixed(6).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return text === '-0' ? '0' : text;
}

/**
 * Round a time to the microsecond FFmpeg works in, so float drift such as
 * 12.094999999666 cannot leave a sub-microsecond sliver between two values.
 * @param {number} seconds
 * @returns {number}
 */
export function microseconds(seconds) {
  return Math.round(seconds * 1e6) / 1e6;
}
