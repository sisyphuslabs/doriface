import { ColorSwatch, FontFamilyList, PaletteEditor, SettingRow, ShortcutField, Switch } from "../../src/index.ts";
import { Cell, FORCED, Row, Section } from "./specimen.tsx";

const SAMPLE = "#9fb4e6";
const PALETTE = Array.from({ length: 16 }, (_, index) => `var(--term-color-${index})`);

/** The parts of the Ghostty-grade terminal settings, each in the states it ships with. */
export function TerminalSettingsParts() {
  return (
    <Section title="Terminal settings parts">
      <Row>
        {FORCED.map((state) => (
          <Cell key={state.label} label={`ColorSwatch · ${state.label}`}>
            <ColorSwatch color={SAMPLE} label="cursor" value={SAMPLE} data-force={state.force} className="w-28" />
          </Cell>
        ))}
        <Cell label="ColorSwatch · selected">
          <ColorSwatch color={SAMPLE} label="cursor" value={SAMPLE} selected className="w-28" />
        </Cell>
        <Cell label="ColorSwatch · disabled">
          <ColorSwatch color={SAMPLE} label="cursor" value={SAMPLE} disabled className="w-28" />
        </Cell>
      </Row>
      <Cell label="PaletteEditor · ansi 4 selected" className="items-stretch">
        <PaletteEditor colors={PALETTE} selected={4} showValues={false} />
      </Cell>
      <Row>
        <Cell label="ShortcutField · idle">
          <ShortcutField action="New tab" keys={["⌘", "T"]} />
        </Cell>
        <Cell label="ShortcutField · modified, reset">
          <ShortcutField action="Next tab" keys={["⌃", "⇥"]} modified />
        </Cell>
        <Cell label="ShortcutField · recording">
          <ShortcutField action="Split down" keys={["⌘", "⇧", "D"]} state="recording" />
        </Cell>
        <Cell label="ShortcutField · conflict">
          <ShortcutField
            action="Previous agent"
            keys={["⌘", "["]}
            state="conflict"
            pending={["⌘", "B"]}
            conflictWith="Toggle sidebar"
          />
        </Cell>
      </Row>
      <div className="grid items-start gap-6 md:grid-cols-2">
        <Cell label="FontFamilyList · primary, missing fallback" className="items-stretch">
          <FontFamilyList
            families={["JetBrains Mono", "Symbols Nerd Font Mono"]}
            missing={["Symbols Nerd Font Mono"]}
          />
        </Cell>
        <div className="flex flex-col">
          <SettingRow
            inline
            title="Blink"
            configKey="cursor-style-blink"
            control={<Switch aria-label="Blink" defaultChecked />}
          />
          <SettingRow
            inline
            title="Thicken glyphs"
            configKey="font-thicken"
            disabledReason="Only Ghostty's macOS renderer can thicken strokes."
            control={<Switch aria-label="Thicken glyphs" />}
          />
        </div>
      </div>
    </Section>
  );
}
