import { Button, Card, Flex, Heading, Separator } from "@radix-ui/themes";
import { SweepRequest, toNumber } from "../model";
import { LabeledNumberInput } from "../components/labeled-input";

type SweepFrPageProps = {
  request: SweepRequest;
  onChangeRequest: (request: SweepRequest) => void;
  running: boolean;
  onRun: () => void;
};

export function SweepFrPage({ request, onChangeRequest, running, onRun }: SweepFrPageProps) {
  return (
    <Card className="glass-panel rounded-3xl">
      <Heading size="4">Sweep Frequency Response</Heading>
      <Separator my="3" size="4" />

      <div className="grid gap-3 md:grid-cols-2">
        <LabeledNumberInput
          label="Start Frequency (Hz)"
          value={request.f0}
          onChange={(event) => onChangeRequest({ ...request, f0: toNumber(event.target.value, 20) })}
        />
        <LabeledNumberInput
          label="End Frequency (Hz)"
          value={request.f1}
          onChange={(event) =>
            onChangeRequest({ ...request, f1: toNumber(event.target.value, 20000) })
          }
        />
        <LabeledNumberInput
          label="Duration (s)"
          value={request.durationSecs}
          step={0.1}
          onChange={(event) =>
            onChangeRequest({ ...request, durationSecs: toNumber(event.target.value, 6) })
          }
        />
        <LabeledNumberInput
          label="Repeats"
          value={request.repeats}
          min={1}
          max={16}
          onChange={(event) =>
            onChangeRequest({
              ...request,
              repeats: Math.max(1, Math.round(toNumber(event.target.value, 1)))
            })
          }
        />
        <LabeledNumberInput
          label="Amplitude"
          value={request.amplitude}
          step={0.05}
          min={0}
          max={1}
          onChange={(event) =>
            onChangeRequest({ ...request, amplitude: toNumber(event.target.value, 0.5) })
          }
        />
      </div>

      <Flex className="mt-4" gap="3" align="center">
        <Button disabled={running} onClick={onRun}>
          Run Sweep
        </Button>
      </Flex>
    </Card>
  );
}
