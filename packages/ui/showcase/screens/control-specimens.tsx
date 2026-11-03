import { Copy, Plus, Settings } from "lucide-react";
import {
  Button,
  Field,
  IconButton,
  Input,
  NumberStepper,
  SegmentedControl,
  Switch,
  Tab,
  TabList,
  Tabs,
  Tooltip,
} from "../../src/index.ts";
import { Cell, FORCED, Row, Section } from "./specimen.tsx";

const VARIANTS = ["primary", "secondary", "ghost", "destructive"] as const;

/** Buttons, icon buttons, inputs and the small value controls, each in every state. */
export function ControlSpecimens() {
  return (
    <>
      <Section title="Button">
        {VARIANTS.map((variant) => (
          <Row key={variant}>
            {FORCED.map((state) => (
              <Cell key={state.label} label={`${variant} · ${state.label}`}>
                <Button variant={variant} data-force={state.force}>
                  Pair host
                </Button>
              </Cell>
            ))}
            <Cell label={`${variant} · disabled`}>
              <Button variant={variant} disabled>
                Pair host
              </Button>
            </Cell>
            <Cell label={`${variant} · loading`}>
              <Button variant={variant} loading>
                Pair host
              </Button>
            </Cell>
          </Row>
        ))}
        <Row>
          <Cell label="sm">
            <Button size="sm">Small</Button>
          </Cell>
          <Cell label="md">
            <Button>Medium</Button>
          </Cell>
          <Cell label="lg">
            <Button size="lg">Large</Button>
          </Cell>
        </Row>
      </Section>

      <Section title="IconButton and Tooltip">
        <Row>
          {FORCED.map((state) => (
            <Cell key={state.label} label={state.label}>
              <IconButton label="New tab" icon={<Plus />} data-force={state.force} />
            </Cell>
          ))}
          <Cell label="pressed toggle">
            <IconButton label="Settings" icon={<Settings />} pressed />
          </Cell>
          <Cell label="disabled">
            <IconButton label="Copy" icon={<Copy />} disabled />
          </Cell>
          <Cell label="tooltip open" className="pb-8">
            <Tooltip label="Close pane" keys={["⌘", "⇧", "W"]} defaultOpen>
              <Button size="sm">Hover target</Button>
            </Tooltip>
          </Cell>
        </Row>
      </Section>

      <Section title="Input and Field">
        <Row className="[&>*]:w-60">
          {FORCED.map((state) => (
            <Cell key={state.label} label={state.label}>
              <Input aria-label={`Host, ${state.label}`} placeholder="host.local:7501" data-force={state.force} />
            </Cell>
          ))}
          <Cell label="invalid">
            <Input aria-label="Host, invalid" defaultValue="host:99999" invalid />
          </Cell>
          <Cell label="disabled">
            <Input aria-label="Host, disabled" defaultValue="relay-doriface.omo.dev" disabled />
          </Cell>
          <Field label="Pairing code" htmlFor="code-demo" hint="8 characters">
            <Input id="code-demo" mono defaultValue="F7K3 9D2M" />
          </Field>
          <Field label="Host address" htmlFor="host-demo" error="Port must be 1-65535.">
            <Input id="host-demo" defaultValue="studio.local:99999" invalid />
          </Field>
        </Row>
      </Section>

      <Section title="Switch, SegmentedControl, NumberStepper, Tabs">
        <Row>
          <Cell label="off">
            <Switch aria-label="Sounds off" />
          </Cell>
          <Cell label="on">
            <Switch aria-label="Sounds on" defaultChecked />
          </Cell>
          <Cell label="focus-visible">
            <Switch aria-label="Sounds focus" data-force="focus" />
          </Cell>
          <Cell label="disabled">
            <Switch aria-label="Sounds disabled" disabled defaultChecked />
          </Cell>
          <Cell label="segmented">
            <SegmentedControl
              label="Route"
              value="relay"
              options={[
                { value: "relay", label: "Relay" },
                { value: "direct", label: "Direct" },
              ]}
            />
          </Cell>
          <Cell label="stepper">
            <NumberStepper label="Font size" defaultValue={14} min={9} max={28} />
          </Cell>
          <Cell label="tabs" className="w-80">
            <Tabs defaultValue="connections" className="w-full">
              <TabList>
                <Tab value="connections">Connections</Tab>
                <Tab value="appearance">Appearance</Tab>
                <Tab value="keyboard">Keyboard</Tab>
              </TabList>
            </Tabs>
          </Cell>
        </Row>
      </Section>
    </>
  );
}
