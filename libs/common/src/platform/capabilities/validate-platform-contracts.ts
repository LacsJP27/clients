/** Thrown at startup when a client did not register every platform contract it must provide. */
export class MissingPlatformContractError extends Error {
  readonly name = "MissingPlatformContractError";

  constructor(
    readonly client: string,
    readonly missing: readonly string[],
  ) {
    super(`The ${client} client did not register: ${missing.join(", ")}`);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Fails loudly when a required platform contract has no implementation (ADR-0001, component 3).
 * Each client calls this once at the end of its own bootstrap with the bindings it registered, so
 * a missing binding stops startup instead of surfacing later inside a feature.
 *
 * @param client Name of the client being started, for the error message.
 * @param bindings Contract name to registered implementation.
 */
export function validatePlatformContracts(client: string, bindings: Record<string, unknown>): void {
  const missing = Object.entries(bindings)
    .filter(([, implementation]) => implementation === null || implementation === undefined)
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new MissingPlatformContractError(client, missing);
  }
}
