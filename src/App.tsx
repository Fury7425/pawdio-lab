
import { useEffect, useMemo, useRef, useState } from "react";
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

type PageKey = "latency" | "sweep" | "experimental" | "devices" | "results";

type AudioDeviceInfo = {
  index: number;
  name: string;
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

type RuntimeStatus = { running: boolean };

type LatencyRequest = {
  signal: "sine" | "impulse" | "pinkNoise";
  frequencyHz: number;
  durationSecs: number;
  amplitude: number;
  repeats: number;
  recordMarginSecs: number;
};
type SweepRequest = {
  f0: number;
  f1: number;
  durationSecs: number;
  repeats: number;
  amplitude: number;
};
type BalanceRequest = {
  frequencyHz: number;
  toneDurationSecs: number;
  settleSecs: number;
};
type CrosstalkRequest = {
  frequencyHz: number;
  toneDurationSecs: number;
  settleSecs: number;
  direction: "LtoR" | "RtoL";
};
type ThdRequest = {
  tones: number[];
  toneDurationSecs: number;
  amplitude: number;
};
type IsolationRequest = { noiseDurationSecs: number; amplitude: number };

type LatencyProgress = { current: number; total: number; delayMs: number | null };
type LatencyReport = {
  signal: string;
  sampleRate: number;
  inputSampleRate: number;
  measurements: Array<{ iteration: number; delayMs: number | null }>;
  averageDelayMs: number | null;
  stdDevMs: number | null;
  cancelled: boolean;
  timestampUtc: string;
};

type TestPayload = {
  test: string;
  timestamp: string;
  params: Record<string, unknown>;
  metrics: Record<string, unknown>;
  data: Record<string, unknown>;
  files: Record<string, unknown>;
};

type TestProgress = {
  test: string;
  current: number;
  total: number;
  message: string;
};

const pages: Array<{ key: PageKey; label: string }> = [
  { key: "latency", label: "Latency" },
  { key: "sweep", label: "Sweep FR" },
  { key: "experimental", label: "Experimental" },
  { key: "devices", label: "Devices / Settings" },
  { key: "results", label: "Results / Log" }
];

const defaultSettings: AudioSettings = {
  outputDeviceIndex: null,
  inputDeviceIndex: null,
  outputSampleRate: 44100,
  inputSampleRate: 44100,
  durationSecs: 0.5,
  chunkSize: 1024
};

const defaultLatency: LatencyRequest = {
  signal: "impulse",
  frequencyHz: 1000,
  durationSecs: 0.5,
  amplitude: 0.85,
  repeats: 5,
  recordMarginSecs: 1
};

const defaultSweep: SweepRequest = { f0: 20, f1: 20000, durationSecs: 6, repeats: 1, amplitude: 0.5 };
const defaultBalance: BalanceRequest = { frequencyHz: 1000, toneDurationSecs: 1, settleSecs: 0.2 };
const defaultCrosstalk: CrosstalkRequest = {
  frequencyHz: 1000,
  toneDurationSecs: 1,
  settleSecs: 0.2,
  direction: "LtoR"
};
const defaultThd: ThdRequest = { tones: [100, 1000, 6000], toneDurationSecs: 1, amplitude: 0.6 };
const defaultIsolation: IsolationRequest = { noiseDurationSecs: 2, amplitude: 0.4 };

const toSel = (n: number | null) => (n === null ? "none" : String(n));
const fromSel = (v: string) => (v === "none" ? null : Number(v));
const num = (v: string, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const fmtMs = (v: number | null) => (v === null ? "-" : `${v.toFixed(2)} ms`);
const parseTones = (v: string) =>
  v
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((x) => Number.isFinite(x) && x > 0);
const legacyTs = (raw: string) => {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${yy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
};

export default function App() {
  const [page, setPage] = useState<PageKey>("latency");
  const [inventory, setInventory] = useState<DeviceInventory | null>(null);
  const [settings, setSettings] = useState<AudioSettings>(defaultSettings);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [latencyReq, setLatencyReq] = useState<LatencyRequest>(defaultLatency);
  const [latencyRows, setLatencyRows] = useState<LatencyProgress[]>([]);
  const [latencyReport, setLatencyReport] = useState<LatencyReport | null>(null);

  const [sweepReq, setSweepReq] = useState<SweepRequest>(defaultSweep);
  const [balanceReq, setBalanceReq] = useState<BalanceRequest>(defaultBalance);
  const [crosstalkReq, setCrosstalkReq] = useState<CrosstalkRequest>(defaultCrosstalk);
  const [thdReq, setThdReq] = useState<ThdRequest>(defaultThd);
  const [thdText, setThdText] = useState("100, 1000, 6000");
  const [isolationReq, setIsolationReq] = useState<IsolationRequest>(defaultIsolation);

  const [logs, setLogs] = useState<string[]>([]);
  const [results, setResults] = useState<Array<{ id: number; payload: TestPayload }>>([]);
  const nextId = useRef(1);

  const progressPct = useMemo(() => {
    if (latencyRows.length === 0) return 0;
    const last = latencyRows[latencyRows.length - 1];
    return Math.floor((last.current / last.total) * 100);
  }, [latencyRows]);

  const logText = useMemo(() => logs.join("\n"), [logs]);
  const resultText = useMemo(
    () => results.map((x) => JSON.stringify(x.payload, null, 2)).join("\n\n"),
    [results]
  );

  const addLog = (line: string) => {
    const stamp = new Date().toLocaleTimeString("en-US", { hour12: false });
    setLogs((prev) => [...prev, `[${stamp}] ${line}`]);
  };

  const addResult = (payload: TestPayload) => {
    setResults((prev) => [...prev, { id: nextId.current++, payload }]);
    addLog(`[${payload.test}] result recorded`);
  };

  async function refreshRuntime() {
    try {
      const status = await invoke<RuntimeStatus>("get_runtime_status");
      setRunning(status.running);
    } catch {
      setRunning(false);
    }
  }

  async function loadState() {
    setError(null);
    const [devices, live] = await Promise.all([
      invoke<DeviceInventory>("list_audio_devices"),
      invoke<AudioSettings>("get_audio_settings")
    ]);
    setInventory(devices);
    const merged = { ...live };
    if (merged.outputDeviceIndex === null && devices.defaultOutputIndex !== null) {
      merged.outputDeviceIndex = devices.defaultOutputIndex;
    }
    if (merged.inputDeviceIndex === null && devices.defaultInputIndex !== null) {
      merged.inputDeviceIndex = devices.defaultInputIndex;
    }
    const committed = await invoke<AudioSettings>("set_audio_settings", { settings: merged });
    setSettings(committed);
  }

  async function commitSettings(next: AudioSettings) {
    setSettings(next);
    const committed = await invoke<AudioSettings>("set_audio_settings", { settings: next });
    setSettings(committed);
  }

  async function runPayload(command: string, request: unknown, startLog: string) {
    if (running) return;
    setError(null);
    setRunning(true);
    addLog(startLog);
    try {
      const payload = await invoke<TestPayload>(command, { request });
      addResult({ ...payload, timestamp: legacyTs(payload.timestamp) });
    } catch (err) {
      setError(String(err));
      addLog(`[error] ${String(err)}`);
    } finally {
      refreshRuntime().catch(() => undefined);
    }
  }

  async function runLatency() {
    if (running) return;
    setError(null);
    setRunning(true);
    setLatencyRows([]);
    setLatencyReport(null);
    addLog(`[latency] started (${latencyReq.signal})`);
    try {
      const report = await invoke<LatencyReport>("run_latency_test", { request: latencyReq });
      setLatencyReport(report);
      addResult({
        test: "latency",
        timestamp: legacyTs(report.timestampUtc),
        params: {
          signal: latencyReq.signal,
          frequency_hz: latencyReq.frequencyHz,
          duration: latencyReq.durationSecs,
          repeats: latencyReq.repeats,
          amplitude: latencyReq.amplitude,
          record_margin: latencyReq.recordMarginSecs
        },
        metrics: {
          average_delay_ms: report.averageDelayMs,
          std_dev_ms: report.stdDevMs,
          cancelled: report.cancelled
        },
        data: {
          sample_rate: report.sampleRate,
          input_sample_rate: report.inputSampleRate,
          measurements: report.measurements
        },
        files: {}
      });
    } catch (err) {
      setError(String(err));
      addLog(`[error] ${String(err)}`);
    } finally {
      refreshRuntime().catch(() => undefined);
    }
  }

  async function stopTest() {
    try {
      await invoke("stop_test");
      addLog("[runtime] stop requested");
    } catch (err) {
      setError(String(err));
    } finally {
      refreshRuntime().catch(() => undefined);
    }
  }

  useEffect(() => {
    loadState().catch((err) => setError(String(err)));
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      refreshRuntime().catch(() => undefined);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let offLatency: null | (() => void) = null;
    let offProgress: null | (() => void) = null;

    listen<LatencyProgress>("latency-progress", (event) => {
      setLatencyRows((prev) => [...prev, event.payload]);
    })
      .then((off) => {
        offLatency = off;
      })
      .catch((err) => setError(String(err)));

    listen<TestProgress>("test-progress", (event) => {
      addLog(`[${event.payload.test}] ${event.payload.message}`);
    })
      .then((off) => {
        offProgress = off;
      })
      .catch((err) => setError(String(err)));

    return () => {
      if (offLatency) offLatency();
      if (offProgress) offProgress();
    };
  }, []);

  return (
    <main className="subtle-grid min-h-screen p-4 md:p-6">
      <div className="mx-auto grid max-w-7xl gap-4 lg:grid-cols-[260px_1fr]">
        <Card className="glass-panel rounded-3xl p-3">
          <Flex direction="column" gap="3">
            <div className="px-2 pb-1">
              <Heading size="6">PawdioLab</Heading>
              <Text size="2" color="gray">Sidebar workflow</Text>
            </div>
            <Separator size="4" />
            {pages.map((item) => (
              <Button
                key={item.key}
                variant={page === item.key ? "solid" : "soft"}
                onClick={() => setPage(item.key)}
              >
                {item.label}
              </Button>
            ))}
            <Separator size="4" />
            <Badge color={running ? "amber" : "green"}>{running ? "Running" : "Idle"}</Badge>
            <Button variant="soft" onClick={() => loadState().catch((err) => setError(String(err)))}>
              Refresh Devices
            </Button>
            <Button color="red" variant="soft" disabled={!running} onClick={stopTest}>
              Stop Test
            </Button>
          </Flex>
        </Card>

        <div className="flex flex-col gap-4">
          {error && (
            <Card className="glass-panel rounded-3xl">
              <Text color="red">{error}</Text>
            </Card>
          )}

          {page === "devices" && (
            <Card className="glass-panel rounded-3xl">
              <Heading size="4">Devices / Settings</Heading>
              <Separator my="3" size="4" />
              <Flex direction="column" gap="3">
                <Text size="2" color="gray">Output Device</Text>
                <Select.Root
                  value={toSel(settings.outputDeviceIndex)}
                  onValueChange={(value) =>
                    commitSettings({ ...settings, outputDeviceIndex: fromSel(value) }).catch((err) =>
                      setError(String(err))
                    )
                  }
                >
                  <Select.Trigger />
                  <Select.Content>
                    <Select.Item value="none">System Default</Select.Item>
                    {(inventory?.outputs ?? []).map((d) => (
                      <Select.Item key={d.index} value={String(d.index)}>
                        {d.name} ({d.channels}ch @ {d.defaultSampleRate}Hz)
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>

                <Text size="2" color="gray">Input Device</Text>
                <Select.Root
                  value={toSel(settings.inputDeviceIndex)}
                  onValueChange={(value) =>
                    commitSettings({ ...settings, inputDeviceIndex: fromSel(value) }).catch((err) =>
                      setError(String(err))
                    )
                  }
                >
                  <Select.Trigger />
                  <Select.Content>
                    <Select.Item value="none">System Default</Select.Item>
                    {(inventory?.inputs ?? []).map((d) => (
                      <Select.Item key={d.index} value={String(d.index)}>
                        {d.name} ({d.channels}ch @ {d.defaultSampleRate}Hz)
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>

                <div className="grid gap-3 sm:grid-cols-2">
                  <TextField.Root
                    type="number"
                    value={settings.outputSampleRate}
                    onChange={(event) =>
                      commitSettings({ ...settings, outputSampleRate: num(event.target.value, 44100) }).catch(
                        (err) => setError(String(err))
                      )
                    }
                  />
                  <TextField.Root
                    type="number"
                    value={settings.inputSampleRate}
                    onChange={(event) =>
                      commitSettings({ ...settings, inputSampleRate: num(event.target.value, 44100) }).catch(
                        (err) => setError(String(err))
                      )
                    }
                  />
                </div>
              </Flex>
            </Card>
          )}

          {page === "latency" && (
            <>
              <Card className="glass-panel rounded-3xl">
                <Heading size="4">Latency</Heading>
                <Separator my="3" size="4" />
                <Flex direction="column" gap="3">
                  <Select.Root
                    value={latencyReq.signal}
                    onValueChange={(value) =>
                      setLatencyReq((prev) => ({ ...prev, signal: value as LatencyRequest["signal"] }))
                    }
                  >
                    <Select.Trigger />
                    <Select.Content>
                      <Select.Item value="impulse">Impulse</Select.Item>
                      <Select.Item value="sine">Sine</Select.Item>
                      <Select.Item value="pinkNoise">Pink Noise</Select.Item>
                    </Select.Content>
                  </Select.Root>
                  <div className="grid gap-3 md:grid-cols-3">
                    <TextField.Root
                      type="number"
                      value={latencyReq.frequencyHz}
                      onChange={(e) =>
                        setLatencyReq((prev) => ({ ...prev, frequencyHz: num(e.target.value, 1000) }))
                      }
                    />
                    <TextField.Root
                      type="number"
                      min={1}
                      max={64}
                      value={latencyReq.repeats}
                      onChange={(e) =>
                        setLatencyReq((prev) => ({
                          ...prev,
                          repeats: Math.max(1, Math.round(num(e.target.value, 1)))
                        }))
                      }
                    />
                    <TextField.Root
                      type="number"
                      step="0.05"
                      value={latencyReq.durationSecs}
                      onChange={(e) =>
                        setLatencyReq((prev) => ({ ...prev, durationSecs: num(e.target.value, 0.5) }))
                      }
                    />
                  </div>
                  <Flex align="center" gap="3" wrap="wrap">
                    <Button disabled={running} onClick={runLatency}>Run Latency</Button>
                    <Text size="2" color="gray">Progress {progressPct}%</Text>
                    <Text size="2" color="gray">Avg {fmtMs(latencyReport?.averageDelayMs ?? null)}</Text>
                    <Text size="2" color="gray">Std {fmtMs(latencyReport?.stdDevMs ?? null)}</Text>
                  </Flex>
                </Flex>
              </Card>

              <Card className="glass-panel rounded-3xl">
                <Heading size="4">Live Results</Heading>
                <Separator my="3" size="4" />
                <div className="max-h-72 overflow-auto rounded-2xl border border-white/10 bg-black/20 p-3">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="text-left text-slate-300">
                        <th className="pb-2">Iteration</th>
                        <th className="pb-2">Delay</th>
                      </tr>
                    </thead>
                    <tbody>
                      {latencyRows.map((row) => (
                        <tr key={`${row.current}-${row.total}`} className="border-t border-white/5">
                          <td className="py-2">{row.current}</td>
                          <td className="py-2">{fmtMs(row.delayMs)}</td>
                        </tr>
                      ))}
                      {latencyRows.length === 0 && (
                        <tr>
                          <td colSpan={2} className="py-4 text-slate-400">Waiting for latency data</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )}

          {page === "sweep" && (
            <Card className="glass-panel rounded-3xl">
              <Heading size="4">Sweep FR</Heading>
              <Separator my="3" size="4" />
              <div className="grid gap-3 md:grid-cols-2">
                <TextField.Root
                  type="number"
                  value={sweepReq.f0}
                  onChange={(e) => setSweepReq((prev) => ({ ...prev, f0: num(e.target.value, 20) }))}
                />
                <TextField.Root
                  type="number"
                  value={sweepReq.f1}
                  onChange={(e) => setSweepReq((prev) => ({ ...prev, f1: num(e.target.value, 20000) }))}
                />
                <TextField.Root
                  type="number"
                  value={sweepReq.durationSecs}
                  onChange={(e) =>
                    setSweepReq((prev) => ({ ...prev, durationSecs: num(e.target.value, 6) }))
                  }
                />
                <TextField.Root
                  type="number"
                  value={sweepReq.repeats}
                  onChange={(e) =>
                    setSweepReq((prev) => ({
                      ...prev,
                      repeats: Math.max(1, Math.round(num(e.target.value, 1)))
                    }))
                  }
                />
              </div>
              <div className="mt-3 flex gap-3">
                <TextField.Root
                  type="number"
                  value={sweepReq.amplitude}
                  onChange={(e) =>
                    setSweepReq((prev) => ({ ...prev, amplitude: num(e.target.value, 0.5) }))
                  }
                />
                <Button
                  disabled={running}
                  onClick={() => runPayload("run_sweep_fr_test", sweepReq, "[SWEEP FR] running")}
                >
                  Run Sweep
                </Button>
              </div>
            </Card>
          )}

          {page === "experimental" && (
            <Card className="glass-panel rounded-3xl">
              <Heading size="4">Experimental Tests</Heading>
              <Separator my="3" size="4" />
              <div className="grid gap-3 md:grid-cols-2">
                <Card>
                  <Heading size="3">Balance</Heading>
                  <Flex direction="column" gap="2" mt="2">
                    <TextField.Root
                      type="number"
                      value={balanceReq.frequencyHz}
                      onChange={(e) =>
                        setBalanceReq((prev) => ({ ...prev, frequencyHz: num(e.target.value, 1000) }))
                      }
                    />
                    <Button
                      disabled={running}
                      onClick={() => runPayload("run_balance_test", balanceReq, "[BALANCE] running")}
                    >
                      Run
                    </Button>
                  </Flex>
                </Card>

                <Card>
                  <Heading size="3">Crosstalk</Heading>
                  <Flex direction="column" gap="2" mt="2">
                    <TextField.Root
                      type="number"
                      value={crosstalkReq.frequencyHz}
                      onChange={(e) =>
                        setCrosstalkReq((prev) => ({ ...prev, frequencyHz: num(e.target.value, 1000) }))
                      }
                    />
                    <Select.Root
                      value={crosstalkReq.direction}
                      onValueChange={(value) =>
                        setCrosstalkReq((prev) => ({
                          ...prev,
                          direction: value as CrosstalkRequest["direction"]
                        }))
                      }
                    >
                      <Select.Trigger />
                      <Select.Content>
                        <Select.Item value="LtoR">LtoR</Select.Item>
                        <Select.Item value="RtoL">RtoL</Select.Item>
                      </Select.Content>
                    </Select.Root>
                    <Button
                      disabled={running}
                      onClick={() => runPayload("run_crosstalk_test", crosstalkReq, "[CROSSTALK] running")}
                    >
                      Run
                    </Button>
                  </Flex>
                </Card>

                <Card>
                  <Heading size="3">THD</Heading>
                  <Flex direction="column" gap="2" mt="2">
                    <TextField.Root value={thdText} onChange={(e) => setThdText(e.target.value)} />
                    <Button
                      disabled={running}
                      onClick={() => {
                        const tones = parseTones(thdText);
                        if (tones.length === 0) {
                          setError("THD tones are required. Example: 100, 1000, 6000");
                          return;
                        }
                        const next = { ...thdReq, tones };
                        setThdReq(next);
                        runPayload("run_thd_test", next, "[THD] running").catch((err) =>
                          setError(String(err))
                        );
                      }}
                    >
                      Run
                    </Button>
                  </Flex>
                </Card>

                <Card>
                  <Heading size="3">Isolation</Heading>
                  <Flex direction="column" gap="2" mt="2">
                    <TextField.Root
                      type="number"
                      value={isolationReq.noiseDurationSecs}
                      onChange={(e) =>
                        setIsolationReq((prev) => ({
                          ...prev,
                          noiseDurationSecs: num(e.target.value, 2)
                        }))
                      }
                    />
                    <Button
                      disabled={running}
                      onClick={() => runPayload("run_isolation_test", isolationReq, "[ISOLATION] running")}
                    >
                      Run
                    </Button>
                  </Flex>
                </Card>
              </div>
            </Card>
          )}

          {page === "results" && (
            <>
              <Card className="glass-panel rounded-3xl">
                <Heading size="4">Results Output</Heading>
                <Separator my="3" size="4" />
                <div className="max-h-80 overflow-auto rounded-2xl border border-white/10 bg-black/25 p-3">
                  <pre className="whitespace-pre-wrap text-xs text-slate-200">
                    {resultText.length > 0 ? resultText : "No test results yet."}
                  </pre>
                </div>
              </Card>

              <Card className="glass-panel rounded-3xl">
                <Flex align="center" justify="between">
                  <Heading size="4">Log</Heading>
                  <Flex gap="2">
                    <Button
                      variant="soft"
                      onClick={() => navigator.clipboard.writeText(logText).catch((err) => setError(String(err)))}
                    >
                      Copy Log
                    </Button>
                    <Button variant="soft" onClick={() => setLogs([])}>Clear Log</Button>
                    <Button variant="soft" onClick={() => setResults([])}>Clear Results</Button>
                  </Flex>
                </Flex>
                <Separator my="3" size="4" />
                <div className="max-h-80 overflow-auto rounded-2xl border border-white/10 bg-black/25 p-3">
                  <pre className="whitespace-pre-wrap text-xs text-slate-200">
                    {logText.length > 0 ? logText : "No logs yet."}
                  </pre>
                </div>
              </Card>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
