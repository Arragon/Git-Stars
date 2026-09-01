export type SyncIdentityDecision =
  | { status: 'ok' }
  | {
      status: 'conflict';
      code: 'IDENTITY_CONFLICT';
      message: string;
      githubId: string;
      sessionUserId: string;
      existingUserId: string;
    };

export function resolveSyncIdentity(params: {
  githubId: string;
  sessionUserId: string;
  existingUserId?: string | null;
}): SyncIdentityDecision {
  const { githubId, sessionUserId, existingUserId } = params;

  if (existingUserId == null || existingUserId === sessionUserId) {
    return { status: 'ok' };
  }

  return {
    status: 'conflict',
    code: 'IDENTITY_CONFLICT',
    message: `GitHub account ${githubId} is already linked to local user record ${existingUserId}, which differs from the current session user ${sessionUserId}. Sync aborted; no data was deleted.`,
    githubId,
    sessionUserId,
    existingUserId,
  };
}
