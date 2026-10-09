export class NotFoundError extends Error {
  readonly status = 404;
}
export class ConflictError extends Error {
  readonly status = 409;
}
export class BadRequestError extends Error {
  readonly status = 400;
  constructor(
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}
