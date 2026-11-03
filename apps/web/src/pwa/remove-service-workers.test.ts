import { describe, expect, test } from "bun:test";
import { removeServiceWorkers } from "./remove-service-workers.ts";

const registration = (unregistered: string[], name: string): ServiceWorkerRegistration => {
  const fake = Object.create(null);
  fake.unregister = async () => {
    unregistered.push(name);
    return true;
  };
  return fake;
};

describe("removeServiceWorkers", () => {
  test("unregisters every worker and deletes every cache", async () => {
    const unregistered: string[] = [];
    const deleted: string[] = [];
    const result = await removeServiceWorkers({
      serviceWorker: {
        getRegistrations: async () => [registration(unregistered, "a"), registration(unregistered, "b")],
      },
      caches: {
        keys: async () => ["workbox-precache-v2", "runtime"],
        delete: async (name: string) => {
          deleted.push(name);
          return true;
        },
      },
    });
    expect(unregistered).toEqual(["a", "b"]);
    expect(deleted).toEqual(["workbox-precache-v2", "runtime"]);
    expect(result).toEqual({ workers: 2, caches: 2 });
  });

  test("does nothing where the APIs are missing", async () => {
    expect(await removeServiceWorkers({})).toEqual({ workers: 0, caches: 0 });
  });
});
