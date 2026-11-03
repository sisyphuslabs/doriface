import { describe, expect, test } from "bun:test";
import { contentSecurityPolicy } from "../src/config/csp.ts";
import { isAllowedExternal } from "../src/config/external.ts";
import { APP_ORIGIN, isSameOrigin, loopbackDevUrl } from "../src/config/origin.ts";
import { isGrantable } from "../src/config/permissions.ts";
import { secureWebPreferences, TRAFFIC_LIGHT_POSITION, windowOptions } from "../src/config/window.ts";
import { VERSION_ARG } from "../src/shared/bridge.ts";

const directives = (csp: string): ReadonlyMap<string, readonly string[]> =>
  new Map(
    csp.split("; ").map((directive) => {
      const [name = "", ...sources] = directive.split(" ");
      return [name, sources] as const;
    }),
  );

describe("main process window config", () => {
  test("webPreferences isolate and sandbox the renderer", () => {
    expect(secureWebPreferences("/app/preload.cjs", "1.2.3")).toEqual({
      preload: "/app/preload.cjs",
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      safeDialogs: true,
      spellcheck: false,
      additionalArguments: [`${VERSION_ARG}1.2.3`],
    });
  });

  test("macOS gets a hidden-inset titlebar with positioned traffic lights; others keep the native frame", () => {
    const prefs = secureWebPreferences("/p", "0.0.0");
    const mac = windowOptions("darwin", prefs);
    expect(mac.titleBarStyle).toBe("hiddenInset");
    expect(mac.trafficLightPosition).toEqual({ x: TRAFFIC_LIGHT_POSITION.x, y: TRAFFIC_LIGHT_POSITION.y });
    expect(mac.webPreferences).toBe(prefs);
    for (const platform of ["linux", "win32"] as const) {
      const options = windowOptions(platform, prefs);
      expect(options.titleBarStyle).toBeUndefined();
      expect(options.trafficLightPosition).toBeUndefined();
      expect(options.show).toBe(false);
    }
  });
});

describe("content security policy", () => {
  test("production allows only same-origin scripts and styles, plus WebAssembly", () => {
    const csp = directives(contentSecurityPolicy());
    expect(csp.get("default-src")).toEqual(["'self'"]);
    expect(csp.get("script-src")).toEqual(["'self'", "'wasm-unsafe-eval'"]);
    expect(csp.get("style-src")).toEqual(["'self'"]);
    for (const name of ["object-src", "frame-src", "frame-ancestors", "base-uri", "form-action"]) {
      expect(csp.get(name)).toEqual(["'none'"]);
    }
    expect(csp.get("connect-src")).toEqual([
      "'self'",
      "ws:",
      "wss:",
      "http://127.0.0.1:*",
      "http://localhost:*",
      "http://[::1]:*",
    ]);
    expect([...csp.values()].flat()).not.toContain("'unsafe-eval'");
    expect([...csp.values()].flat()).not.toContain("'unsafe-inline'");
  });

  test("dev mode admits Vite's inline preamble and nothing else extra", () => {
    const csp = directives(contentSecurityPolicy({ devServer: "http://localhost:5173" }));
    expect(csp.get("script-src")).toEqual(["'self'", "'wasm-unsafe-eval'", "'unsafe-inline'"]);
    expect(csp.get("style-src")).toEqual(["'self'", "'unsafe-inline'"]);
    expect(csp.get("object-src")).toEqual(["'none'"]);
  });
});

describe("origin, external links and permissions", () => {
  test("the app origin matches by scheme and host", () => {
    expect(isSameOrigin("app://doriface/index.html", APP_ORIGIN)).toBe(true);
    expect(isSameOrigin("app://evil/index.html", APP_ORIGIN)).toBe(false);
    expect(isSameOrigin("https://doriface/", APP_ORIGIN)).toBe(false);
    expect(isSameOrigin("not a url", APP_ORIGIN)).toBe(false);
  });

  test("only a loopback http dev server may become the app origin", () => {
    expect(loopbackDevUrl("http://localhost:5173")).toBe("http://localhost:5173/");
    expect(loopbackDevUrl("http://127.0.0.1:5173/")).toBe("http://127.0.0.1:5173/");
    expect(loopbackDevUrl("http://[::1]:5173")).toBe("http://[::1]:5173/");
    for (const url of ["https://localhost:5173", "http://example.com:5173", "http://10.0.0.2:5173", "file:///x", "x"]) {
      expect(() => loopbackDevUrl(url)).toThrow("refusing dev server");
    }
  });

  test("only https links to allowlisted hosts open externally", () => {
    expect(isAllowedExternal("https://github.com/sisyphuslabs/doriface")).toBe(true);
    expect(isAllowedExternal("https://docs.omo.dev/x")).toBe(true);
    expect(isAllowedExternal("http://github.com/")).toBe(false);
    expect(isAllowedExternal("https://github.com.evil.example/")).toBe(false);
    expect(isAllowedExternal("https://user:pw@github.com/")).toBe(false);
    expect(isAllowedExternal("file:///etc/passwd")).toBe(false);
    expect(isAllowedExternal("javascript:alert(1)")).toBe(false);
  });

  test("permissions are denied unless the app origin asks for a clipboard write", () => {
    expect(isGrantable("clipboard-sanitized-write", "app://doriface/", APP_ORIGIN)).toBe(true);
    expect(isGrantable("clipboard-sanitized-write", "https://example.com/", APP_ORIGIN)).toBe(false);
    for (const permission of ["media", "geolocation", "notifications", "clipboard-read", "openExternal"]) {
      expect(isGrantable(permission, "app://doriface/", APP_ORIGIN)).toBe(false);
    }
  });
});
