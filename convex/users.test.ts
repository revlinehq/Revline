/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
const identity = (subject: string, profile = {}) => ({ subject, issuer: 'https://test.clerk.accounts.dev', tokenIdentifier: `https://test.clerk.accounts.dev|${subject}`, ...profile });

describe('verified Clerk profile synchronization', () => {
  test('requires authentication and never accepts a client-selected identity', async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.users.store, {})).rejects.toThrow('Authentication required');
    await expect(t.query(api.users.current, {})).rejects.toThrow('Authentication required');
    const owner = t.withIdentity(identity('owner'));
    // @ts-expect-error Prove that callers cannot nominate a different Clerk user.
    await expect(owner.mutation(api.users.store, { clerkId: 'other' })).rejects.toThrow();
  });

  test('creates one profile per verified identity and reads only that identity', async () => {
    const t = convexTest(schema, modules);
    const first = t.withIdentity(identity('first', { email: 'first@example.test', name: 'First user' }));
    const second = t.withIdentity(identity('second', { email: 'second@example.test' }));
    expect(await first.query(api.users.current, {})).toBeNull();
    const firstId = await first.mutation(api.users.store, {});
    expect(await first.mutation(api.users.store, {})).toBe(firstId);
    const secondId = await second.mutation(api.users.store, {});
    expect(secondId).not.toBe(firstId);
    expect(await first.query(api.users.current, {})).toMatchObject({ _id: firstId, clerkId: 'first', email: 'first@example.test' });
    expect(await second.query(api.users.current, {})).toMatchObject({ _id: secondId, clerkId: 'second', email: 'second@example.test' });
    const rows = await t.run(ctx => ctx.db.query('users').withIndex('by_clerk_id', q => q.eq('clerkId', 'first')).take(2));
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty('plan');
  });

  test('updates supplied verified claims without erasing absent claims or rewriting unchanged rows', async () => {
    const t = convexTest(schema, modules);
    const owner = t.withIdentity(identity('owner', { email: 'owner@example.test', name: 'Original', pictureUrl: 'https://example.test/avatar.png' }));
    const id = await owner.mutation(api.users.store, {});
    const original = await owner.query(api.users.current, {});
    expect(await owner.mutation(api.users.store, {})).toBe(id);
    expect(await owner.query(api.users.current, {})).toEqual(original);
    const refreshed = t.withIdentity(identity('owner', { name: 'Updated' }));
    expect(await refreshed.mutation(api.users.store, {})).toBe(id);
    expect(await refreshed.query(api.users.current, {})).toMatchObject({ email: 'owner@example.test', name: 'Updated', imageUrl: 'https://example.test/avatar.png', createdAt: original!.createdAt });
  });

  test('private Clerk lifecycle removal is exact and idempotent, retaining projects and other profiles', async () => {
    const t = convexTest(schema, modules);
    const first = t.withIdentity(identity('first'));
    const second = t.withIdentity(identity('second'));
    await first.mutation(api.users.store, {});
    const secondId = await second.mutation(api.users.store, {});
    const projectId = await first.mutation(api.projects.create, { title: 'Retained project', aspectRatio: 'vertical' });
    const projectBefore = await first.query(api.projects.get, { projectId });
    expect(await t.mutation(internal.users.removeFromClerk, { clerkId: 'first' })).toBeNull();
    expect(await t.mutation(internal.users.removeFromClerk, { clerkId: 'first' })).toBeNull();
    expect(await first.query(api.users.current, {})).toBeNull();
    expect(await second.query(api.users.current, {})).toMatchObject({ _id: secondId, clerkId: 'second' });
    expect(await first.query(api.projects.get, { projectId })).toEqual(projectBefore);
  });
});
