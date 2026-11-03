export interface ServiceWorkerHost {
  readonly serviceWorker?: Pick<ServiceWorkerContainer, "getRegistrations">;
  readonly caches?: Pick<CacheStorage, "keys" | "delete">;
}

export async function removeServiceWorkers(
  host: ServiceWorkerHost = { serviceWorker: navigator.serviceWorker, caches: globalThis.caches },
): Promise<{ readonly workers: number; readonly caches: number }> {
  const registrations = (await host.serviceWorker?.getRegistrations()) ?? [];
  const unregistered = await Promise.all(registrations.map((registration) => registration.unregister()));
  const names = (await host.caches?.keys()) ?? [];
  const deleted = await Promise.all(names.map((name) => host.caches?.delete(name) ?? Promise.resolve(false)));
  return { workers: unregistered.filter(Boolean).length, caches: deleted.filter(Boolean).length };
}
