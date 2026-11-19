import { firstValueFrom, Observable, of, Subject, toArray } from "rxjs";

import { SupportStatus, supportSwitch } from "./support-status";

type FakeService = { name: string };

const fakeService: FakeService = { name: "fake-service" };

describe("supportSwitch", () => {
  it("sends supported statuses to the supported selector with the service", async () => {
    const supported = jest.fn((service: FakeService) => of(`supported:${service.name}`));
    const notSupported = jest.fn((reason: string) => of(`not-supported:${reason}`));

    const status: SupportStatus<FakeService> = { type: "supported", service: fakeService };

    const result = await firstValueFrom(
      of(status).pipe(supportSwitch({ supported, notSupported })),
    );

    expect(result).toBe("supported:fake-service");
    expect(supported).toHaveBeenCalledTimes(1);
    expect(supported).toHaveBeenCalledWith(fakeService, 0);
    expect(notSupported).not.toHaveBeenCalled();
  });

  it.each([
    { type: "not-supported", reason: "platform-not-supported" },
    { type: "needs-configuration", reason: "feature-disabled" },
  ] as const)(
    "sends $type statuses to the notSupported selector with the reason",
    async (status) => {
      const supported = jest.fn((service: FakeService) => of(`supported:${service.name}`));
      const notSupported = jest.fn((reason: string) => of(`not-supported:${reason}`));

      const result = await firstValueFrom(
        of<SupportStatus<FakeService>>(status).pipe(supportSwitch({ supported, notSupported })),
      );

      expect(result).toBe(`not-supported:${status.reason}`);
      expect(notSupported).toHaveBeenCalledTimes(1);
      expect(notSupported).toHaveBeenCalledWith(status.reason, 0);
      expect(supported).not.toHaveBeenCalled();
    },
  );

  it("sends unavailable statuses to the unavailable selector when it is given", async () => {
    const supported = jest.fn((service: FakeService) => of(`supported:${service.name}`));
    const notSupported = jest.fn((reason: string) => of(`not-supported:${reason}`));
    const unavailable = jest.fn((reason: string) => of(`unavailable:${reason}`));

    const status: SupportStatus<FakeService> = {
      type: "unavailable",
      reason: "server-unreachable",
    };

    const result = await firstValueFrom(
      of(status).pipe(supportSwitch({ supported, notSupported, unavailable })),
    );

    expect(result).toBe("unavailable:server-unreachable");
    expect(unavailable).toHaveBeenCalledTimes(1);
    expect(unavailable).toHaveBeenCalledWith("server-unreachable", 0);
    expect(notSupported).not.toHaveBeenCalled();
    expect(supported).not.toHaveBeenCalled();
  });

  it("falls back to the notSupported selector for unavailable statuses when no unavailable selector is given", async () => {
    const supported = jest.fn((service: FakeService) => of(`supported:${service.name}`));
    const notSupported = jest.fn((reason: string) => of(`not-supported:${reason}`));

    const status: SupportStatus<FakeService> = {
      type: "unavailable",
      reason: "server-unreachable",
    };

    const result = await firstValueFrom(
      of(status).pipe(supportSwitch({ supported, notSupported })),
    );

    expect(result).toBe("not-supported:server-unreachable");
    expect(notSupported).toHaveBeenCalledTimes(1);
    expect(notSupported).toHaveBeenCalledWith("server-unreachable", 0);
    expect(supported).not.toHaveBeenCalled();
  });

  it("passes the source index to each selector", async () => {
    const supported = jest.fn((service: FakeService) => of(`supported:${service.name}`));
    const notSupported = jest.fn((reason: string) => of(`not-supported:${reason}`));
    const unavailable = jest.fn((reason: string) => of(`unavailable:${reason}`));

    const statuses: SupportStatus<FakeService>[] = [
      { type: "supported", service: fakeService },
      { type: "not-supported", reason: "platform-not-supported" },
      { type: "unavailable", reason: "server-unreachable" },
      { type: "needs-configuration", reason: "feature-disabled" },
      { type: "supported", service: fakeService },
    ];

    const results = await firstValueFrom(
      of(...statuses).pipe(supportSwitch({ supported, notSupported, unavailable }), toArray()),
    );

    expect(results).toEqual([
      "supported:fake-service",
      "not-supported:platform-not-supported",
      "unavailable:server-unreachable",
      "not-supported:feature-disabled",
      "supported:fake-service",
    ]);
    expect(supported.mock.calls).toEqual([
      [fakeService, 0],
      [fakeService, 4],
    ]);
    expect(notSupported.mock.calls).toEqual([
      ["platform-not-supported", 1],
      ["feature-disabled", 3],
    ]);
    expect(unavailable.mock.calls).toEqual([["server-unreachable", 2]]);
  });

  it("unsubscribes from the previous inner observable when a new status arrives", () => {
    const source = new Subject<SupportStatus<FakeService>>();
    const supportedInner = new Subject<string>();
    const unavailableInner = new Subject<string>();

    const supported = jest.fn((): Observable<string> => supportedInner);
    const notSupported = jest.fn((reason: string) => of(`not-supported:${reason}`));
    const unavailable = jest.fn((): Observable<string> => unavailableInner);

    const emitted: string[] = [];
    const subscription = source
      .pipe(supportSwitch({ supported, notSupported, unavailable }))
      .subscribe((value) => emitted.push(value));

    source.next({ type: "supported", service: fakeService });
    supportedInner.next("first");
    expect(supportedInner.observed).toBe(true);

    source.next({ type: "unavailable", reason: "server-unreachable" });
    expect(supportedInner.observed).toBe(false);
    expect(unavailableInner.observed).toBe(true);

    supportedInner.next("ignored");
    unavailableInner.next("second");

    source.next({ type: "not-supported", reason: "platform-not-supported" });
    expect(unavailableInner.observed).toBe(false);

    unavailableInner.next("ignored");

    expect(emitted).toEqual(["first", "second", "not-supported:platform-not-supported"]);

    subscription.unsubscribe();
  });
});
