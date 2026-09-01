export const IDENTITY_CONFLICT_MESSAGE =
  'This GitHub account is already linked to a different local user record. Sync was aborted and no data was deleted. Please contact the deployment owner to resolve the account conflict.';

export type SyncIdentityDecision =
  | { status: 'ok' }
  | {
      status: 'conflict';
      code: 'IDENTITY_CONFLICT';
      reason: 'existing_record' | 'unique_violation';
      message: string;
    };

export function resolveSyncIdentity(params: {
  githubId: string;
  sessionUserId: string;
  existingUserId?: string | null;
}): SyncIdentityDecision {
  const { sessionUserId, existingUserId } = params;

  if (existingUserId == null || existingUserId === sessionUserId) {
    return { status: 'ok' };
  }

  return {
    status: 'conflict',
    code: 'IDENTITY_CONFLICT',
    reason: 'existing_record',
    message: IDENTITY_CONFLICT_MESSAGE,
  };
}

export function isIdentityUniqueViolation(
  error: { code?: string | null; message?: string | null; details?: string | null } | null | undefined,
): boolean {
  if (error?.code !== '23505') {
    return false;
  }

  return `${error.message ?? ''} ${error.details ?? ''}`.toLowerCase().includes('github_id');
}
