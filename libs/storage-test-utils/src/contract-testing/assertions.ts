/**
 * Runner-independent assertions, so the contract suites need no test-runner type definitions and
 * stay inside the platform-neutral type check.
 */
export class ContractAssertionError extends Error {
  readonly name = "ContractAssertionError";
}

export function fail(message: string): never {
  throw new ContractAssertionError(message);
}

export function assertTrue(condition: boolean, message: string): void {
  if (!condition) {
    fail(message);
  }
}

export function assertDeepEqual(actual: unknown, expected: unknown, message: string): void {
  if (!deepEqual(actual, expected)) {
    fail(`${message}\n  expected: ${describe(expected)}\n  actual:   ${describe(actual)}`);
  }
}

/** What a contract's typed error looks like to the assertions: a recognizer and a display name. */
export interface ContractErrorType<E extends { code: string }> {
  readonly name: string;
  is(error: unknown): error is E;
}

/**
 * Calls `operation` and asserts that it returns a promise that rejects with the contract's typed
 * error carrying `code`, without throwing synchronously. Resolves to that error.
 */
export async function assertRejectsWithCode<E extends { code: string }>(
  errorType: ContractErrorType<E>,
  operation: () => Promise<unknown>,
  code: E["code"],
  message: string,
): Promise<E> {
  let result: unknown;
  try {
    result = operation();
  } catch (error) {
    fail(`${message}: threw synchronously (${describeError(error)}) instead of rejecting`);
  }
  if (!isThenable(result)) {
    fail(`${message}: did not return a promise`);
  }

  try {
    await result;
  } catch (error) {
    if (!errorType.is(error)) {
      fail(
        `${message}: rejected with ${describeError(error)}, expected ${errorType.name}(${code})`,
      );
    }
    assertTrue(
      error.code === code,
      `${message}: rejected with code ${error.code}, expected ${code}`,
    );
    return error;
  }
  fail(`${message}: resolved, expected rejection with ${code}`);
}

/**
 * Like `Promise.all`, but waits for every promise to settle before rethrowing the first rejection,
 * so a failing implementation produces a test failure rather than unhandled rejections.
 */
export async function awaitAll<T>(promises: Array<Promise<T>>): Promise<T[]> {
  const results = await Promise.allSettled(promises);
  const rejected = results.find((result) => result.status === "rejected");
  if (rejected !== undefined) {
    throw rejected.reason;
  }
  return results.map((result) => (result as PromiseFulfilledResult<T>).value);
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  return aKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(bRecord, key) && deepEqual(aRecord[key], bRecord[key]),
  );
}

function describe(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}
