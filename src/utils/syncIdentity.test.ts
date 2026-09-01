import { describe, expect, it } from 'vitest';
import { resolveSyncIdentity } from './syncIdentity';

describe('resolveSyncIdentity', () => {
  it('allows a GitHub account without an existing local record', () => {
    expect(
      resolveSyncIdentity({
        githubId: 'gh-1',
        sessionUserId: 'user-1',
      }),
    ).toEqual({ status: 'ok' });
  });

  it('allows an existing record belonging to the current session user', () => {
    expect(
      resolveSyncIdentity({
        githubId: 'gh-1',
        sessionUserId: 'user-1',
        existingUserId: 'user-1',
      }),
    ).toEqual({ status: 'ok' });
  });

  it('rejects an existing record belonging to another session user', () => {
    expect(
      resolveSyncIdentity({
        githubId: 'gh-1',
        sessionUserId: 'user-1',
        existingUserId: 'user-2',
      }),
    ).toMatchObject({
      status: 'conflict',
      code: 'IDENTITY_CONFLICT',
      existingUserId: 'user-2',
    });
  });
});
