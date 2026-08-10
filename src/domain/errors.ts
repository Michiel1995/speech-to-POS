export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export class UnsupportedCapabilityError extends DomainError {
  constructor(message: string) {
    super(message, "UNSUPPORTED_POS_CAPABILITY", 422);
    this.name = "UnsupportedCapabilityError";
  }
}
