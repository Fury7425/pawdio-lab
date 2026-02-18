import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import {
  Badge,
  Button,
  Card,
  Flex,
  Heading,
  Select,
  Separator,
  Text,
  TextField
} from "@radix-ui/themes";

type AudioDeviceInfo = {
  index: number;
  name: string;
  isInput: boolean;
  channels: number;
  defaultSampleRate: number;
};

type DeviceInventory = {
  inputs: AudioDeviceInfo[];
  outputs: AudioDeviceInfo[];
  defaultInputIndex: number | null;
  defaultOutputIndex: number | null;
};

type AudioSettings = {
  outputDeviceIndex: number | null;
  inputDeviceIndex: number | null;
  outputSampleRate: number;
  inputSampleRate: number;
  durationSecs: number;
  chunkSize: number;
};

type LatencyTestRequest = {
  signal: "sine" | "impulse" | "pinkNoise";
  frequencyHz: number;
  durationSecs: number;
  amplitude: number;
  repeats: number;
  recordMarginSecs: number;
};

type LatencyProgressEvent = {
  current: number;
  total: number;
  delayMs: number | null;
};

type LatencyMeasurement = {
  iteration: number;
  delayMs: number | null;
};

type LatencyTestReport = {
  signal: "sine" | "impulse" | "pinkNoise";
  sampleRate: number;
  inputSampleRate: number;
  measurements: LatencyMeasurement[];
  averageDelayMs: number | null;
  stdDevMs: number | null;
  cancelled: boolean;
  timestampUtc: string;
};

type RuntimeStatus = {
  running: boolean;
};

const defaultSettings: AudioSettings = {
  outputDeviceIndex: null,
  inputDeviceIndex: null,
  outputSampleRate: 44100,
  inputSampleRate: 44100,
  durationSecs: 0.5,
  chunkSize: 1024
};

const defaultRequest: LatencyTestRequest = {
  signal: "impulse",
  frequencyHz: 1000,
  durationSecs: 0.5,
  amplitude: 0.85,
  repeats: 5,
  recordMarginSecs: 1
};

function toSelectValue(index: number | null): string {
  return index === null ? "none" : String(index);
}

function fromSelectValue(value: string): number | null {
  if (value === "none") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function fmt(value: number | null): string {
  return value === null ? "-" : `${value.toFixed(2)} ms`;
}

export default function App() {
  const [inventory, setInventory] = useState<DeviceInventory | null>(null);
  const [settings, setSettings] = useState<AudioSettings>(defaultSettings);
  const [request, setRequest] = useState<LatencyTestRequest>(defaultRequest);
  const [running, setRunning] = useState(false);
  const [progressRows, setProgressRows] = useState<LatencyProgressEvent[]>([]);
  const [report, setReport] = useState<LatencyTestReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const progress = useMemo(() => {
    if (progressRows.length === 0) {
      return 0;
    }
    const latest = progressRows[progressRows.length - 1];
    return Math.floor((latest.current / latest.total) * 100);
  }, [progressRows]);

  async function loadState() {
    setError(null);
    const [devices, liveSettings] = await Promise.all([
      invoke<DeviceInventory>("list_audio_devices"),
      invoke<AudioSettings>("get_audio_settings")
    ]);
    setInventory(devices);
    const merged = { ...liveSettings };
    if (merged.inputDeviceIndex === null && devices.defaultInputIndex !== null) {
      merged.inputDeviceIndex = devices.defaultInputIndex;
    }
    if (merged.outputDeviceIndex === null && devices.defaultOutputIndex !== null) {
      merged.outputDeviceIndex = devices.defaultOutputIndex;
    }
    const committed = await invoke<AudioSettings>("set_audio_settings", {
      settings: merged
    });
    setSettings(committed);
  }

  async function commitSettings(next: AudioSettings) {
    setSettings(next);
    const committed = await invoke<AudioSettings>("set_audio_settings", {
      settings: next
    });
    setSettings(committed);
  }

  async function runTest() {
    setError(null);
    setProgressRows([]);
    setReport(null);
    setRunning(true);
    try {
      const result = await invoke<LatencyTestReport>("run_latency_test", {
        request
      });
      setReport(result);
    } catch (err) {
      setError(String(err));
    } finally {
      try {
        const status = await invoke<RuntimeStatus>("get_runtime_status");
        setRunning(status.running);
      } catch {
        setRunning(false);
      }
    }
  }

  async function stopTest() {
    await invoke("stop_latency_test");
  }

  useEffect(() => {
    loadState().catch((err) => setError(String(err)));
  }, []);

  useEffect(() => {
    let mounted = true;
    const timer = setInterval(async () => {
      try {
        const status = await invoke<RuntimeStatus>("get_runtime_status");
        if (mounted) {
          setRunning(status.running);
        }
      } catch {
        if (mounted) {
          setRunning(false);
        }
      }
    }, 1000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let unlisten: null | (() => void) = null;
    listen<LatencyProgressEvent>("latency-progress", (event) => {
      setProgressRows((prev) => [...prev, event.payload]);
    })
      .then((off) => {
        unlisten = off;
      })
      .catch((err) => setError(String(err)));
    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  return (
    <main className="subtle-grid min-h-screen p-4 md:p-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <Card className="glass-panel rounded-3xl">
          <Flex align="center" justify="between" gap="4" wrap="wrap">
            <div>
              <Heading size="6">Pawdio Lab</Heading>
              <Text color="gray">
                Tauri + Rust low-latency audio diagnostics for desktop QA
              </Text>
            </div>
            <Flex align="center" gap="3">
              <Badge color={running ? "amber" : "green"}>
                {running ? "Running" : "Idle"}
              </Badge>
              <Button variant="soft" onClick={() => loadState().catch((err) => setError(String(err)))}>
                Refresh Devices
              </Button>
            </Flex>
          </Flex>
        </Card>

        <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
          <Card className="glass-panel rounded-3xl">
            <Heading size="4">Audio Device Routing</Heading>
            <Separator my="3" size="4" />
            <Flex direction="column" gap="3">
              <Text size="2" color="gray">
                Output Device
              </Text>
              <Select.Root
                value={toSelectValue(settings.outputDeviceIndex)}
                onValueChange={(value) =>
                  commitSettings({
                    ...settings,
                    outputDeviceIndex: fromSelectValue(value)
                  }).catch((err) => setError(String(err)))
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

              <Text size="2" color="gray">
                Input Device
              </Text>
              <Select.Root
                value={toSelectValue(settings.inputDeviceIndex)}
                onValueChange={(value) =>
                  commitSettings({
                    ...settings,
                    inputDeviceIndex: fromSelectValue(value)
                  }).catch((err) => setError(String(err)))
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

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1">
                  <Text size="2" color="gray">
                    Output Sample Rate
                  </Text>
                  <TextField.Root
                    type="number"
                    value={settings.outputSampleRate}
                    onChange={(event) =>
                      commitSettings({
                        ...settings,
                        outputSampleRate: Number(event.target.value || 44100)
                      }).catch((err) => setError(String(err)))
                    }
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <Text size="2" color="gray">
                    Input Sample Rate
                  </Text>
                  <TextField.Root
                    type="number"
                    value={settings.inputSampleRate}
                    onChange={(event) =>
                      commitSettings({
                        ...settings,
                        inputSampleRate: Number(event.target.value || 44100)
                      }).catch((err) => setError(String(err)))
                    }
                  />
                </label>
              </div>
            </Flex>
          </Card>

          <Card className="glass-panel rounded-3xl">
            <Heading size="4">Latency Test Control</Heading>
            <Separator my="3" size="4" />
            <Flex direction="column" gap="3">
              <Text size="2" color="gray">
                Signal Type
              </Text>
              <Select.Root
                value={request.signal}
                onValueChange={(value) =>
                  setRequest((prev) => ({
                    ...prev,
                    signal: value as LatencyTestRequest["signal"]
                  }))
                }
              >
                <Select.Trigger />
                <Select.Content>
                  <Select.Item value="impulse">Impulse</Select.Item>
                  <Select.Item value="sine">Sine</Select.Item>
                  <Select.Item value="pinkNoise">Pink Noise</Select.Item>
                </Select.Content>
              </Select.Root>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1">
                  <Text size="2" color="gray">
                    Frequency (Hz)
                  </Text>
                  <TextField.Root
                    type="number"
                    value={request.frequencyHz}
                    onChange={(event) =>
                      setRequest((prev) => ({
                        ...prev,
                        frequencyHz: Number(event.target.value || 1000)
                      }))
                    }
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <Text size="2" color="gray">
                    Repeats
                  </Text>
                  <TextField.Root
                    type="number"
                    min={1}
                    max={64}
                    value={request.repeats}
                    onChange={(event) =>
                      setRequest((prev) => ({
                        ...prev,
                        repeats: Number(event.target.value || 1)
                      }))
                    }
                  />
                </label>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <label className="flex flex-col gap-1">
                  <Text size="2" color="gray">
                    Duration (s)
                  </Text>
                  <TextField.Root
                    type="number"
                    step="0.05"
                    value={request.durationSecs}
                    onChange={(event) =>
                      setRequest((prev) => ({
                        ...prev,
                        durationSecs: Number(event.target.value || 0.5)
                      }))
                    }
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <Text size="2" color="gray">
                    Amplitude
                  </Text>
                  <TextField.Root
                    type="number"
                    step="0.05"
                    min={0}
                    max={1}
                    value={request.amplitude}
                    onChange={(event) =>
                      setRequest((prev) => ({
                        ...prev,
                        amplitude: Number(event.target.value || 0.8)
                      }))
                    }
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <Text size="2" color="gray">
                    Record Margin (s)
                  </Text>
                  <TextField.Root
                    type="number"
                    step="0.1"
                    min={0.1}
                    value={request.recordMarginSecs}
                    onChange={(event) =>
                      setRequest((prev) => ({
                        ...prev,
                        recordMarginSecs: Number(event.target.value || 1)
                      }))
                    }
                  />
                </label>
              </div>

              <Flex align="center" gap="3" wrap="wrap">
                <Button disabled={running} onClick={runTest}>
                  Run Test
                </Button>
                <Button color="red" variant="soft" disabled={!running} onClick={stopTest}>
                  Stop
                </Button>
                <Text size="2" color="gray">
                  Progress {progress}%
                </Text>
              </Flex>
            </Flex>
          </Card>
        </div>

        <Card className="glass-panel rounded-3xl">
          <Heading size="4">Live Results</Heading>
          <Separator my="3" size="4" />
          {error && (
            <Text color="red" size="2">
              {error}
            </Text>
          )}
          <div className="mt-3 grid gap-4 lg:grid-cols-[1fr_auto]">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
              <div className="max-h-60 overflow-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="text-left text-slate-300">
                      <th className="pb-2">Iteration</th>
                      <th className="pb-2">Delay</th>
                    </tr>
                  </thead>
                  <tbody>
                    {progressRows.map((row) => (
                      <tr key={`${row.current}-${row.total}`} className="border-t border-white/5">
                        <td className="py-2">{row.current}</td>
                        <td className="py-2">{fmt(row.delayMs)}</td>
                      </tr>
                    ))}
                    {progressRows.length === 0 && (
                      <tr>
                        <td colSpan={2} className="py-4 text-slate-400">
                          Waiting for data
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="w-full min-w-64 rounded-2xl border border-white/10 bg-black/20 p-3">
              <Text as="p" size="2" color="gray">
                Average
              </Text>
              <Heading size="5">{fmt(report?.averageDelayMs ?? null)}</Heading>
              <Text as="p" size="2" color="gray" className="mt-3">
                Std Dev
              </Text>
              <Heading size="4">{fmt(report?.stdDevMs ?? null)}</Heading>
              <Text as="p" size="2" color="gray" className="mt-3">
                Signal
              </Text>
              <Text>{report?.signal ?? "-"}</Text>
              <Text as="p" size="2" color="gray" className="mt-3">
                Sample Rate
              </Text>
              <Text>{report ? `${report.sampleRate} Hz` : "-"}</Text>
            </div>
          </div>
        </Card>
      </div>
    </main>
  );
}
