import { useState } from "react";
import { FontFamilyList, NumberStepper, PaletteEditor, SegmentedControl, SettingRow } from "../../src/index.ts";
import { Group } from "./settings-sections.tsx";
import {
  Header,
  Mono,
  Rows,
  Swatch,
  ThemePair,
  Toggle,
  terminalColors,
  useFontStack,
} from "./settings-terminal-parts.tsx";

export function TerminalSection() {
  const colors = terminalColors();
  const [cursor, setCursor] = useState<"block" | "bar" | "underline" | "block_hollow">("block");
  const [copy, setCopy] = useState<"false" | "true" | "clipboard">("true");
  const [slot, setSlot] = useState(4);
  const fonts = useFontStack(["JetBrains Mono", "Symbols Nerd Font Mono", "Apple Color Emoji"]);
  return (
    <>
      <Header />
      <Group title="Font">
        <Rows>
          <SettingRow
            title="Font family"
            configKey="font-family"
            description="Tried in order; a glyph missing from one face comes from the next."
            control={null}
          />
          <FontFamilyList {...fonts} missing={["Symbols Nerd Font Mono"]} className="pb-3" />
          <SettingRow
            inline
            title="Font size"
            configKey="font-size"
            control={<NumberStepper label="Font size" defaultValue={14} min={6} max={48} />}
          />
          <SettingRow
            inline
            title="Ligatures"
            configKey="font-feature"
            description="Off writes -calt, -liga."
            control={<Toggle label="Ligatures" on={false} />}
          />
          <SettingRow
            title="Font features"
            configKey="font-feature"
            control={<Mono label="Font features" value="+ss01, +zero" />}
          />
          <SettingRow
            title="Cell height"
            configKey="adjust-cell-height"
            control={<Mono label="Cell height" value="+10%" width="sm:w-24" />}
          />
          <SettingRow
            title="Cell width"
            configKey="adjust-cell-width"
            control={<Mono label="Cell width" value="0" width="sm:w-24" />}
          />
          <SettingRow
            inline
            title="Thicken glyphs"
            configKey="font-thicken"
            disabledReason="Only Ghostty's macOS renderer can thicken strokes; the web terminal uses the browser's text rendering."
            control={<Toggle label="Thicken glyphs" on={false} disabled />}
          />
        </Rows>
      </Group>
      <Group title="Cursor">
        <SettingRow
          title="Style"
          configKey="cursor-style"
          control={
            <SegmentedControl
              label="Cursor style"
              value={cursor}
              onValueChange={setCursor}
              options={[
                { value: "block", label: "Block" },
                { value: "bar", label: "Bar" },
                { value: "underline", label: "Underline" },
                { value: "block_hollow", label: "Hollow" },
              ]}
            />
          }
        />
        <SettingRow inline title="Blink" configKey="cursor-style-blink" control={<Toggle label="Cursor blink" on />} />
        <SettingRow
          inline
          title="Color"
          configKey="cursor-color"
          control={<Swatch label="cursor" color={colors.cursor} />}
        />
      </Group>
      <Group title="Colors">
        <SettingRow
          title="Theme"
          configKey="theme"
          description="One theme for light appearance and one for dark; written as light:<name>,dark:<name>."
          control={<ThemePair light="doriface-day" dark="doriface-night" />}
        />
        <SettingRow
          title="Palette"
          configKey="palette"
          description="The 16 terminal colours, normal over bright."
          control={null}
        />
        <PaletteEditor colors={colors.ansi} selected={slot} onSelect={setSlot} className="pb-3" />
        <SettingRow
          inline
          title="Selection"
          configKey="selection-background"
          control={<Swatch label="selection" color={colors.selection} />}
        />
        <SettingRow
          title="Minimum contrast"
          configKey="minimum-contrast"
          description="1 keeps colours as written; 4.5 forces AA text."
          control={<NumberStepper label="Minimum contrast" defaultValue={1.1} min={1} max={21} step={0.1} />}
        />
        <SettingRow
          inline
          title="Background blur"
          configKey="background-blur"
          disabledReason="Panes are always opaque so terminal text stays readable over anything behind the window."
          control={<Toggle label="Background blur" on={false} disabled />}
        />
      </Group>
      <Group title="Spacing">
        <SettingRow
          inline
          title="Horizontal padding"
          configKey="window-padding-x"
          control={<NumberStepper label="Horizontal padding" defaultValue={8} min={0} max={64} />}
        />
        <SettingRow
          inline
          title="Vertical padding"
          configKey="window-padding-y"
          control={<NumberStepper label="Vertical padding" defaultValue={6} min={0} max={64} />}
        />
        <SettingRow
          inline
          title="Balance padding"
          configKey="window-padding-balance"
          description="Spreads the space left over from whole cells evenly around the grid."
          control={<Toggle label="Balance padding" on />}
        />
      </Group>
      <Group title="Behavior">
        <SettingRow
          title="Scrollback"
          configKey="scrollback-limit"
          description="In bytes, per terminal."
          control={<Mono label="Scrollback" value="10000000" width="sm:w-32" />}
        />
        <SettingRow
          title="Copy on select"
          configKey="copy-on-select"
          control={
            <SegmentedControl
              label="Copy on select"
              value={copy}
              onValueChange={setCopy}
              options={[
                { value: "false", label: "Off" },
                { value: "true", label: "Selection" },
                { value: "clipboard", label: "Clipboard" },
              ]}
            />
          }
        />
        <SettingRow
          inline
          title="Hide mouse while typing"
          configKey="mouse-hide-while-typing"
          control={<Toggle label="Hide mouse while typing" on />}
        />
        <SettingRow
          inline
          title="Paste protection"
          configKey="clipboard-paste-protection"
          description="Asks before pasting text that could run a command."
          control={<Toggle label="Paste protection" on />}
        />
      </Group>
    </>
  );
}
