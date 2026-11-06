import { describe, expect, test } from "bun:test";
import { classify } from "./capture-text.ts";

const patterns = (text: string): string[] => classify(text).findings.map((one) => one.pattern);

describe("a capture's OCR text", () => {
  test("a neutral prompt, home and ssh target pass", () => {
    expect(classify("demo@my-laptop:~/project$ bun test").ok).toBe(true);
    expect(classify("demo@my-laptop ~ % ls").ok).toBe(true);
    expect(classify("/home/demo/project").ok).toBe(true);
    expect(classify("ssh demo@my-laptop").ok).toBe(true);
    expect(classify("user@localhost:~$ ls").ok).toBe(true);
  });

  test("a zsh-style prompt names an account and a host without a colon", () => {
    expect(patterns("alpha-center@build-box ~ % ls")).toContain("prompt: account at host");
  });

  test("a fully qualified host is a host", () => {
    expect(patterns("alpha@build.example.com:~$ ls")).toContain("prompt: account at host");
  });

  test("an account at a host says which shape it trips, never the text", () => {
    const verdict = classify("someone@alpha-box:/srv/run/clone$ ls");
    expect(verdict.findings.map((one) => one.pattern)).toContain("prompt: account at host");
    expect(JSON.stringify(verdict)).not.toContain("someone");
    expect(JSON.stringify(verdict)).not.toContain("alpha-box");
  });

  test("a home or run-root path alone is enough, and a package root is not", () => {
    expect(patterns("/Users/someone/project")).toContain("path: home directory");
    expect(patterns("/srv/runs/x/clone")).toContain("path: run root");
    expect(patterns("/var/folders/xy/abc/T/x")).toContain("path: run root");
    expect(patterns("/tmp/x/clone")).toContain("path: run root");
    expect(classify("/opt/homebrew/bin/bun").ok).toBe(true);
  });

  test("a host name beside this machine is a label, not a prompt", () => {
    expect(patterns("alpha-box\nthis machine\n1")).toContain("label: host name beside this machine");
    expect(classify("my-laptop\nthis machine\n1").ok).toBe(true);
  });

  test("a product name in a mockup is not an identifier", () => {
    expect(classify("MacBook Pro\nSettings\nTheme Light").ok).toBe(true);
    expect(classify("http://127.0.0.1:50170/").ok).toBe(true);
  });
});
