import { firstValueFrom } from "rxjs";

import { UnsupportedSystemNotificationsService } from "./unsupported-system-notifications.service";

describe("UnsupportedSystemNotificationsService", () => {
  let service: UnsupportedSystemNotificationsService;

  beforeEach(() => {
    service = new UnsupportedSystemNotificationsService();
  });

  describe("status", () => {
    it("returns not-supported with client-not-supported reason", () => {
      expect(service.status()).toEqual({
        type: "not-supported",
        reason: "client-not-supported",
      });
    });

    it("never exposes a service", () => {
      expect("service" in service.status()).toBe(false);
    });

    it("agrees with isSupported", () => {
      expect(service.status().type === "supported").toBe(service.isSupported());
    });

    it("returns a consistent result across repeated calls", () => {
      const first = service.status();
      const second = service.status();

      expect(second).toEqual(first);
    });

    it("does not throw even though other members do", () => {
      expect(() => service.status()).not.toThrow();
    });

    it("does not change the behavior of other members", async () => {
      service.status();

      expect(service.isSupported()).toBe(false);
      await expect(service.create({ title: "T", body: "B", buttons: [] })).rejects.toThrow(
        "Create OS Notification unsupported.",
      );
      expect(() => service.clear({ id: "x" })).toThrow("Clear OS Notification unsupported.");
      await expect(firstValueFrom(service.notificationClicked$)).rejects.toThrow(
        "Notification clicked is not supported.",
      );
    });
  });
});
