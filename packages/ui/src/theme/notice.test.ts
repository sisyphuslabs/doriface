import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LIBRARY_CREDITS } from "./library.ts";

const ROOT = join(import.meta.dirname, "../..");
const NOTICE = readFileSync(join(ROOT, "NOTICE"), "utf8");
const APACHE = readFileSync(join(ROOT, "licenses/Apache-2.0.txt"));
const SEPARATOR = /\n-{20,}\n/;
/** Each NOTICE section, keyed by the project URL on its heading line. */
const sections = new Map(
  NOTICE.split(SEPARATOR)
    .slice(1)
    .map((section) => [/\((https:\/\/github\.com\/[^)]+)\)/.exec(section)?.[1] ?? "", section] as const),
);

/** The MIT licence as its projects ship it, after their copyright lines (choosealicense.com's text, as in each repo). */
const MIT_TERMS = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

/** The Apache-2.0 notice every Apache section carries: the licence appendix's boilerplate, unindented. */
const APACHE_NOTICE = `Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.`;

/**
 * licenses/Apache-2.0.txt is Tokyo Night's own LICENSE, the only Apache-2.0 project here: folke/tokyonight.nvim at
 * cdc07ac78467, byte for byte.
 */
const TOKYO_NIGHT_LICENSE_SHA256 = "c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4";

/** A section's licence: the MIT heading, its copyright lines, then the terms exactly; anything cut or edited differs. */
function expectWholeMit(section: string): void {
  const licence = section.slice(section.indexOf("MIT License\n\n") + "MIT License\n\n".length);
  const [copyright = "", ...rest] = licence.split("\n\n");
  expect(copyright.split("\n").every((line) => line.startsWith("Copyright "))).toBe(true);
  expect(rest.join("\n\n").trimEnd()).toBe(MIT_TERMS);
}

const mitSections = [...sections.values()].filter((section) => section.includes("MIT License\n"));

test.each(Object.entries(LIBRARY_CREDITS))("%s carries its project's notice", (_, credit) => {
  const section = sections.get(credit.url);
  expect(section).toBeDefined();
  expect(section).toContain(credit.name);
  if (credit.licence === "MIT") {
    expect(section).toContain("MIT License\n\n");
    expectWholeMit(section ?? "");
  } else {
    expect(section).toContain(APACHE_NOTICE);
  }
});

test("every MIT section carries the whole licence, the collection the palettes came through too", () => {
  expect(mitSections.length).toBeGreaterThan(1);
  for (const section of mitSections) expectWholeMit(section);
  expect(sections.get("https://github.com/mbadolato/iTerm2-Color-Schemes")).toContain(
    "Copyright (c) 2011 to Present Mark Badolato",
  );
});

test("the bundled Apache-2.0 text is Tokyo Night's own licence, whole, and the notice is its appendix's", () => {
  expect(createHash("sha256").update(APACHE).digest("hex")).toBe(TOKYO_NIGHT_LICENSE_SHA256);
  const text = APACHE.toString("utf8");
  const start = text.indexOf("Licensed under the Apache License");
  const end = text.indexOf("limitations under the License.") + "limitations under the License.".length;
  const appendix = text
    .slice(start, end)
    .split("\n")
    .map((line) => line.replace(/^ {3}/, ""))
    .join("\n");
  expect(appendix).toBe(APACHE_NOTICE);
});
