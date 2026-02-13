export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly meta?: Record<string, any>,
  ) {
    super(message);
  }
}
