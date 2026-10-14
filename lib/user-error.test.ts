import { expect,it } from 'vitest';
import { ConvexError } from 'convex/values';
import { userError } from './user-error';
it('preserves application guidance while hiding backend diagnostics',()=>{
  expect(userError(new ConvexError('Wait for the active export'))).toBe('Wait for the active export');
  expect(userError(new ConvexError({message:'Storage is full'}))).toBe('Storage is full');
  expect(userError(new Error('[CONVEX M(x)] Server Error\nUncaught internal details'),'Could not save')).toBe('Could not save');
  expect(userError(new Error('Could not upload this file'))).toBe('Could not upload this file');
});
