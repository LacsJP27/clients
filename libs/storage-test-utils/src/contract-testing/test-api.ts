type TestBody = () => void | Promise<void>;

/** The runner functions a contract suite needs. Jest, Vitest (globals), Mocha, and Jasmine all qualify. */
export interface ContractTestApi {
  describe(name: string, body: () => void): void;
  it: ((name: string, body: TestBody) => void) & { skip(name: string, body: TestBody): void };
  beforeEach(body: TestBody): void;
  afterEach(body: TestBody): void;
}

/** The runner's globals, or a clear error naming the suite that needed them. */
export function globalTestApi(suite: string): ContractTestApi {
  const candidate = globalThis as unknown as Partial<ContractTestApi>;
  if (
    typeof candidate.describe !== "function" ||
    typeof candidate.it !== "function" ||
    typeof candidate.beforeEach !== "function" ||
    typeof candidate.afterEach !== "function"
  ) {
    throw new Error(
      `${suite} needs describe/it/beforeEach/afterEach globals; pass options.testApi when the runner does not provide them`,
    );
  }
  return candidate as ContractTestApi;
}
