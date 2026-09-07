/**
 * Canonical board identity of the Chalkboard Master agent. The socket auth
 * middleware pins the agent to this identity after verifying the shared
 * secret, so handshake claims cannot mint other agent ids or names.
 */
export const AGENT_USER_ID = 'agent:chalkboard-master';
export const AGENT_DISPLAY_NAME = 'Chalkboard Master (AI)';
