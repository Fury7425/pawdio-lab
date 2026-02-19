import { Button, Card, Flex, Heading, Select, Separator, Text } from "@radix-ui/themes";
import { LatencyProgress, LatencyReport, LatencyRequest, fmtMs, toNumber } from "../model";
import { LabeledNumberInput } from "../components/labeled-input";

type LatencyPageProps = {
  request: LatencyRequest;
  onChangeRequest: (request: LatencyRequest) => void;
  progressRows: LatencyProgress[];
  report: LatencyReport | null;
  running: boolean;
  progressPercent: number;
  onRun: () => void;
};

export function LatencyPage({
  request,
  onChangeRequest,
  progressRows,
  report,
  running,
  progressPercent,
  onRun
}: LatencyPageProps) {
  return (
    <div className="flex flex-col gap-4">
      <Card className="glass-panel rounded-3xl">
        <Heading size="4">Latency</Heading>
        <Separator my="3" size="4" />

        <Flex direction="column" gap="3">
          <Text size="2" color="gray">
            Signal Type
          </Text>
          <Select.Root
            value={request.signal}
            onValueChange={(value) =>
              onChangeRequest({
                ...request,
                signal: value as LatencyRequest["signal"]
              })
            }
          >
            <Select.Trigger />
            <Select.Content>
              <Select.Item value="impulse">Click (Impulse)</Select.Item>
              <Select.Item value="sine">Sine Wave</Select.Item>
              <Select.Item value="pinkNoise">Pink Noise</Select.Item>
            </Select.Content>
          </Select.Root>

          <div className="grid gap-3 md:grid-cols-3">
            <LabeledNumberInput
              label="Frequency (Hz)"
              value={request.frequencyHz}
              onChange={(event) =>
                onChangeRequest({ ...request, frequencyHz: toNumber(event.target.value, 1000) })
              }
            />
            <LabeledNumberInput
              label="Repeats"
              value={request.repeats}
              min={1}
              max={64}
              onChange={(event) =>
                onChangeRequest({
                  ...request,
                  repeats: Math.max(1, Math.round(toNumber(event.target.value, 1)))
                })
              }
            />
            <LabeledNumberInput
              label="Duration (s)"
              value={request.durationSecs}
              step={0.05}
              onChange={(event) =>
                onChangeRequest({ ...request, durationSecs: toNumber(event.target.value, 0.5) })
              }
            />
            <LabeledNumberInput
              label="Amplitude"
              value={request.amplitude}
              step={0.05}
              min={0}
              max={1}
              onChange={(event) =>
                onChangeRequest({ ...request, amplitude: toNumber(event.target.value, 0.85) })
              }
            />
            <LabeledNumberInput
              label="Record Margin (s)"
              value={request.recordMarginSecs}
              step={0.1}
              min={0.1}
              onChange={(event) =>
                onChangeRequest({ ...request, recordMarginSecs: toNumber(event.target.value, 1) })
              }
            />
          </div>

          <Flex align="center" gap="3" wrap="wrap">
            <Button disabled={running} onClick={onRun}>
              Run Selected
            </Button>
            <Text size="2" color="gray">
              Progress {progressPercent}%
            </Text>
            <Text size="2" color="gray">
              Average {fmtMs(report?.averageDelayMs ?? null)}
            </Text>
            <Text size="2" color="gray">
              Std Dev {fmtMs(report?.stdDevMs ?? null)}
            </Text>
          </Flex>
        </Flex>
      </Card>

      <Card className="glass-panel rounded-3xl">
        <Heading size="4">Results Summary</Heading>
        <Separator my="3" size="4" />

        <div className="max-h-80 overflow-auto rounded-2xl border border-white/10 bg-black/20 p-3">
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
                  <td className="py-2">{fmtMs(row.delayMs)}</td>
                </tr>
              ))}
              {progressRows.length === 0 && (
                <tr>
                  <td colSpan={2} className="py-4 text-slate-400">
                    Waiting for latency data
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
