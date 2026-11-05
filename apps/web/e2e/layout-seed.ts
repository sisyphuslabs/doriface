// Names, titles, paths and messages at their longest, in Korean and unbroken, for the layout spec's host.
import { E2E_LAYOUT_MACHINE_DIR } from "./config.ts";
import type { MachineSpec, Seed } from "./machine.ts";

/** The layout core's id, fixed so a spec can restore saved tabs for it before the first page load. */
export const LAYOUT_CORE_ID = "1a7e0c0ffee0000000000000000000a1";
export const LAYOUT_CORE = "개발팀 공용 빌드 서버 · 아주 긴 호스트 이름을 가진 워크스테이션 studio-workstation-long";
/** hc caps machine names at 32 characters of a-z 0-9 - _ . */
export const LAYOUT_MACHINE = "remote-build-machine-number-0001";
/** A working directory whose last segment has no break opportunity before its end. */
export const LAYOUT_DIR = "아주긴작업공간이름이계속이어지는디렉터리-monorepo-packages-frontend-design-system";
/** A token with no break opportunity at all. */
export const UNBROKEN = "averyveryverylongunbrokenterminaltitlewithoutanyspacesorhyphens0123456789abcdef";

const b64 = (text: string): string => Buffer.from(text).toString("base64");
/** Sets the window title (OSC 2) and, when given, an OSC 7501 state and message, then waits. */
function program(title: string, state?: string, msg?: string): string[] {
  const osc = state === undefined ? "" : `printf '\\033]7501;state=${state}:msg=${b64(msg ?? "")}\\033\\\\'; `;
  const titled = title === "" ? "" : `printf '\\033]2;%s\\007' '${title}'; `;
  return ["sh", "-c", `${titled}${osc}printf '%s\\n' '$ '; exec sleep 3600`];
}

const space = (name: string): string[] => ["--label", `space=${name}`];

export interface LayoutTerminal {
  /** What the app shows for it: the name, else the title. */
  readonly title: string;
  readonly seed: Seed;
}

const named = (name: string, extra: readonly string[], argv: readonly string[]): LayoutTerminal => ({
  title: name,
  seed: { args: ["--name", name, ...extra], argv },
});
const titled = (title: string, extra: readonly string[], argv: readonly string[]): LayoutTerminal => ({
  title,
  seed: { args: extra, argv },
});

export const LAYOUT_TERMINALS: readonly LayoutTerminal[] = [
  named(
    "a-very-long-terminal-name-32char",
    space("디자인 시스템 리팩터링 작업공간 — a very long workspace name that keeps going"),
    program("", "blocked", "프로덕션 배포를 승인하시겠습니까? 승인하면 모든 리전에 새 버전이 배포됩니다"),
  ),
  titled(
    "배포 파이프라인을 점검하는 아주 긴 터미널 제목 with a long English tail as well",
    space("배포-파이프라인-점검-작업공간-deployment-pipeline-checks"),
    program(
      "배포 파이프라인을 점검하는 아주 긴 터미널 제목 with a long English tail as well",
      "working",
      "빌드 로그를 읽는 중",
    ),
  ),
  titled(UNBROKEN, [], program(UNBROKEN, "done", `${UNBROKEN}-${UNBROKEN}`)),
  named(
    "release-notes-writer-agent-00001",
    [],
    program("", "done", "릴리스 노트 초안을 작성했습니다. 검토가 필요합니다"),
  ),
  named("idle-shell-in-a-very-deep-folder", [], program("")),
  ...[1, 2, 3, 4, 5, 6].map((n) =>
    named(
      `review-agent-with-long-name-0${n}`,
      space(`리뷰 작업공간 ${n}번 — code review space`),
      program("", "working", "변경 사항을 검토하는 중"),
    ),
  ),
];

export const LAYOUT_MACHINE_SPEC: MachineSpec = {
  name: LAYOUT_MACHINE,
  dir: E2E_LAYOUT_MACHINE_DIR,
  seeds: [
    named(
      "remote-terraform-plan-runner-001",
      space("원격 인프라 작업공간 — remote infrastructure"),
      program("", "blocked", "terraform apply 를 승인하시겠습니까?"),
    ).seed,
    titled(
      "원격 머신에서 실행 중인 아주 긴 로그 터미널 제목",
      [],
      program("원격 머신에서 실행 중인 아주 긴 로그 터미널 제목"),
    ).seed,
  ],
};
