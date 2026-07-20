export class APIError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 500, options?: ErrorOptions) {
    super(message, options);
    this.name = 'APIError';
    this.statusCode = statusCode;

    // Keep instanceof APIError reliable when the code is transpiled.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
