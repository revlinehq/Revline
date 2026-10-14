import { afterEach, expect, test, vi } from 'vitest';
import { openingFootage, releaseOpeningFootage, rememberOpeningFootage } from './footage-opening';

afterEach(() => { releaseOpeningFootage('new'); releaseOpeningFootage('old'); vi.restoreAllMocks(); });

test('retains one local poster across navigation and releases only the matching project', () => {
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValueOnce('blob:first').mockReturnValueOnce('blob:second');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const blob = new Blob(['poster']);
  rememberOpeningFootage('old', blob, 'first.mp4');
  expect(openingFootage('old')?.thumbnail).toBe('blob:first');
  expect(openingFootage('new')).toBeUndefined();
  releaseOpeningFootage('new');
  expect(revoke).not.toHaveBeenCalled();
  rememberOpeningFootage('new', blob, 'second.mp4');
  expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:first');
  expect(create).toHaveBeenCalledTimes(2);
  releaseOpeningFootage('new');
  expect(revoke).toHaveBeenLastCalledWith('blob:second');
  expect(openingFootage('new')).toBeUndefined();
});

test('never revokes a persisted remote thumbnail', () => {
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  rememberOpeningFootage('new', 'https://example.test/poster.jpg', 'saved.mp4');
  releaseOpeningFootage('new');
  expect(revoke).not.toHaveBeenCalled();
});
