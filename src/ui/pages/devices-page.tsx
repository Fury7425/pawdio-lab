import { Card, Flex, Heading, Select, Separator, Text } from "@radix-ui/themes";
import {
  AudioSettings,
  DeviceInventory,
  fromSelectValue,
  toNumber,
  toSelectValue
} from "../model";
import { LabeledNumberInput } from "../components/labeled-input";

type DevicesPageProps = {
  inventory: DeviceInventory | null;
  settings: AudioSettings;
  onCommitSettings: (settings: AudioSettings) => void;
};

export function DevicesPage({ inventory, settings, onCommitSettings }: DevicesPageProps) {
  return (
    <Card className="glass-panel rounded-3xl">
      <Heading size="4">Devices / Settings</Heading>
      <Separator my="3" size="4" />

      <Flex direction="column" gap="3">
        <label className="field-row">
          <Text size="2" color="gray">
            Output Device
          </Text>
          <Select.Root
            value={toSelectValue(settings.outputDeviceIndex)}
            onValueChange={(value) =>
              onCommitSettings({
                ...settings,
                outputDeviceIndex: fromSelectValue(value)
              })
            }
          >
            <Select.Trigger />
            <Select.Content>
              <Select.Item value="none">System Default</Select.Item>
              {(inventory?.outputs ?? []).map((device) => (
                <Select.Item key={device.index} value={String(device.index)}>
                  {device.name} ({device.channels}ch @ {device.defaultSampleRate}Hz)
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </label>

        <label className="field-row">
          <Text size="2" color="gray">
            Input Device
          </Text>
          <Select.Root
            value={toSelectValue(settings.inputDeviceIndex)}
            onValueChange={(value) =>
              onCommitSettings({
                ...settings,
                inputDeviceIndex: fromSelectValue(value)
              })
            }
          >
            <Select.Trigger />
            <Select.Content>
              <Select.Item value="none">System Default</Select.Item>
              {(inventory?.inputs ?? []).map((device) => (
                <Select.Item key={device.index} value={String(device.index)}>
                  {device.name} ({device.channels}ch @ {device.defaultSampleRate}Hz)
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </label>

        <div className="grid gap-3 md:grid-cols-2">
          <LabeledNumberInput
            label="Output Sample Rate (Hz)"
            value={settings.outputSampleRate}
            onChange={(event) =>
              onCommitSettings({
                ...settings,
                outputSampleRate: toNumber(event.target.value, 44100)
              })
            }
          />
          <LabeledNumberInput
            label="Input Sample Rate (Hz)"
            value={settings.inputSampleRate}
            onChange={(event) =>
              onCommitSettings({
                ...settings,
                inputSampleRate: toNumber(event.target.value, 44100)
              })
            }
          />
          <LabeledNumberInput
            label="Default Duration (s)"
            value={settings.durationSecs}
            step={0.05}
            onChange={(event) =>
              onCommitSettings({
                ...settings,
                durationSecs: toNumber(event.target.value, 0.5)
              })
            }
          />
          <LabeledNumberInput
            label="Chunk Size"
            value={settings.chunkSize}
            step={1}
            min={64}
            onChange={(event) =>
              onCommitSettings({
                ...settings,
                chunkSize: Math.max(64, Math.round(toNumber(event.target.value, 1024)))
              })
            }
          />
        </div>
      </Flex>
    </Card>
  );
}
