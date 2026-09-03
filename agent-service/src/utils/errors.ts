/**
 * @file errors.ts
 * @description Custom error class for the agent-service.
 */
export class AgentError extends Error {
  readonly code: string;

  constructor(code: string, message?: string, options?: ErrorOptions) {
    super(message ?? code, options);
    this.name = 'AgentError';
    this.code = code;

    // Keep instanceof AgentError reliable when the code is transpiled.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
