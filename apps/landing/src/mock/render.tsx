import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { PhoneMock } from "./phone-mock.tsx";
import { AgentsMock, MachinesMock } from "./sidebar-mock.tsx";
import { WorkspaceMock } from "./workspace-mock.tsx";

export interface MockTheme {
  readonly day: string;
  readonly night: string;
}

export interface Mocks {
  readonly desktop: MockTheme;
  readonly agents: MockTheme;
  readonly machines: MockTheme;
  readonly phone: MockTheme;
}

const LABELS = {
  desktop:
    "A Doriterm window: spaces and an agent list on the left with one agent waiting for an answer, two terminals side by side, and the status bar underneath.",
  agents: "The agent list: one agent waiting under Needs you, two working, two idle.",
  machines: "The machines list: this computer and a second machine called build-box, each with its spaces.",
  phone: "Doriterm on a phone: a terminal above the keys bar for ctrl, shift, tab, esc, the arrows and paste.",
} as const;

const wrap = (theme: "day" | "night", label: string, markup: string): string =>
  `<div class="mock" data-theme="${theme}" data-detect-ignore="tight-leading nested-cards" role="img" aria-label="${label}" inert>${markup}</div>`;

function render(label: string, tree: ReactNode): MockTheme {
  const markup = renderToStaticMarkup(tree);
  return { day: wrap("day", label, markup), night: wrap("night", label, markup) };
}

export function renderMocks(marks: { readonly light: string; readonly dark: string }): Mocks {
  const desktop = (mark: string): MockTheme => render(LABELS.desktop, <WorkspaceMock mark={mark} />);
  const day = desktop(marks.light);
  const night = desktop(marks.dark);
  return {
    desktop: { day: day.day, night: night.night },
    agents: render(LABELS.agents, <AgentsMock />),
    machines: render(LABELS.machines, <MachinesMock />),
    phone: render(LABELS.phone, <PhoneMock />),
  };
}
