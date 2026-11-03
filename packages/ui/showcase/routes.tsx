import type { ComponentType } from "react";
import { MobileAgentsScreen, MobileScreen } from "./screens/mobile.tsx";
import { PairScreen } from "./screens/pair.tsx";
import { PaletteScreen } from "./screens/palette.tsx";
import { PrimitivesScreen } from "./screens/primitives.tsx";
import { SettingsAppearanceScreen, SettingsScreen } from "./screens/settings.tsx";
import { ShellScreen } from "./screens/shell.tsx";
import { StatesScreen } from "./screens/states.tsx";

export const ROUTES = [
  { id: "primitives", title: "Primitives", render: PrimitivesScreen },
  { id: "shell", title: "Workspace shell", render: ShellScreen },
  { id: "pair", title: "Connect and pair", render: PairScreen },
  { id: "palette", title: "Command palette", render: PaletteScreen },
  { id: "settings", title: "Settings", render: SettingsScreen },
  { id: "settings-appearance", title: "Settings: appearance", render: SettingsAppearanceScreen },
  { id: "mobile", title: "Phone", render: MobileScreen },
  { id: "mobile-agents", title: "Phone agents list", render: MobileAgentsScreen },
  { id: "states", title: "Empty, offline and error states", render: StatesScreen },
] as const satisfies readonly { id: string; title: string; render: ComponentType }[];

export type RouteId = (typeof ROUTES)[number]["id"];
