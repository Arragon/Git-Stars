import { describe, expect, it } from 'vitest';
import {
  IDENTITY_CONFLICT_MESSAGE,
  isIdentityUniqueViolation,
  resolveSyncIdentity,
} from './syncIdentity';

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
    const decision = resolveSyncIdentity({
      githubId: 'gh-1',
      sessionUserId: 'user-1',
      existingUserId: 'user-2',
    });

    expect(decision).toEqual({
      status: 'conflict',
      code: 'IDENTITY_CONFLICT',
      reason: 'existing_record',
      message: IDENTITY_CONFLICT_MESSAGE,
    });
    expect(JSON.stringify(decision)).not.toContain('user-1');
    expect(JSON.stringify(decision)).not.toContain('user-2');
  });

  it('recognizes a users github_id unique violation', () => {
    expect(
      isIdentityUniqueViolation({
        code: '23505',
        message: 'duplicate key value violates unique constraint "users_github_id_key"',
        details: 'Key (github_id)=(1) already exists.',
      }),
    ).toBe(true);
  });

  it('rejects unrelated or missing errors as identity unique violations', () => {
    expect(
      isIdentityUniqueViolation({
        code: '23505',
        message: 'duplicate key value violates unique constraint "user_projects_user_id_project_id_type_key"',
      }),
    ).toBe(false);
    expect(isIdentityUniqueViolation({ code: '42501' })).toBe(false);
    expect(isIdentityUniqueViolation(null)).toBe(false);
    expect(isIdentityUniqueViolation(undefined)).toBe(false);
  });
});
