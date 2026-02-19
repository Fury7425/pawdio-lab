import { Button, Card, Flex, Heading, Select, Separator, Text } from "@radix-ui/themes";
import {
  BalanceRequest,
  CrosstalkRequest,
  IsolationRequest,
  ThdRequest,
  toNumber
} from "../model";
import { LabeledNumberInput, LabeledTextInput } from "../components/labeled-input";

type ExperimentalPageProps = {
  running: boolean;
  balanceRequest: BalanceRequest;
  onChangeBalance: (request: BalanceRequest) => void;
  crosstalkRequest: CrosstalkRequest;
  onChangeCrosstalk: (request: CrosstalkRequest) => void;
  thdRequest: ThdRequest;
  thdToneText: string;
  onChangeThdRequest: (request: ThdRequest) => void;
  onChangeThdToneText: (value: string) => void;
  isolationRequest: IsolationRequest;
  onChangeIsolation: (request: IsolationRequest) => void;
  onRunBalance: () => void;
  onRunCrosstalk: () => void;
  onRunThd: () => void;
  onRunIsolation: () => void;
};

export function ExperimentalPage({
  running,
  balanceRequest,
  onChangeBalance,
  crosstalkRequest,
  onChangeCrosstalk,
  thdRequest,
  thdToneText,
  onChangeThdRequest,
  onChangeThdToneText,
  isolationRequest,
  onChangeIsolation,
  onRunBalance,
  onRunCrosstalk,
  onRunThd,
  onRunIsolation
}: ExperimentalPageProps) {
  return (
    <Card className="glass-panel rounded-3xl">
      <Heading size="4">Experimental Tests</Heading>
      <Separator my="3" size="4" />

      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <Heading size="3">Channel Balance</Heading>
          <Flex direction="column" gap="2" mt="3">
            <LabeledNumberInput
              label="Frequency (Hz)"
              value={balanceRequest.frequencyHz}
              onChange={(event) =>
                onChangeBalance({
                  ...balanceRequest,
                  frequencyHz: toNumber(event.target.value, 1000)
                })
              }
            />
            <LabeledNumberInput
              label="Tone Duration (s)"
              value={balanceRequest.toneDurationSecs}
              step={0.1}
              onChange={(event) =>
                onChangeBalance({
                  ...balanceRequest,
                  toneDurationSecs: toNumber(event.target.value, 1)
                })
              }
            />
            <LabeledNumberInput
              label="Settle Time (s)"
              value={balanceRequest.settleSecs}
              step={0.1}
              onChange={(event) =>
                onChangeBalance({
                  ...balanceRequest,
                  settleSecs: toNumber(event.target.value, 0.2)
                })
              }
            />
            <Button disabled={running} onClick={onRunBalance}>
              Run
            </Button>
          </Flex>
        </Card>

        <Card>
          <Heading size="3">Crosstalk</Heading>
          <Flex direction="column" gap="2" mt="3">
            <LabeledNumberInput
              label="Frequency (Hz)"
              value={crosstalkRequest.frequencyHz}
              onChange={(event) =>
                onChangeCrosstalk({
                  ...crosstalkRequest,
                  frequencyHz: toNumber(event.target.value, 1000)
                })
              }
            />
            <LabeledNumberInput
              label="Tone Duration (s)"
              value={crosstalkRequest.toneDurationSecs}
              step={0.1}
              onChange={(event) =>
                onChangeCrosstalk({
                  ...crosstalkRequest,
                  toneDurationSecs: toNumber(event.target.value, 1)
                })
              }
            />
            <LabeledNumberInput
              label="Settle Time (s)"
              value={crosstalkRequest.settleSecs}
              step={0.1}
              onChange={(event) =>
                onChangeCrosstalk({
                  ...crosstalkRequest,
                  settleSecs: toNumber(event.target.value, 0.2)
                })
              }
            />
            <label className="field-row">
              <Text size="2" color="gray">
                Direction
              </Text>
              <Select.Root
                value={crosstalkRequest.direction}
                onValueChange={(value) =>
                  onChangeCrosstalk({
                    ...crosstalkRequest,
                    direction: value as CrosstalkRequest["direction"]
                  })
                }
              >
                <Select.Trigger />
                <Select.Content>
                  <Select.Item value="LtoR">LtoR</Select.Item>
                  <Select.Item value="RtoL">RtoL</Select.Item>
                </Select.Content>
              </Select.Root>
            </label>
            <Button disabled={running} onClick={onRunCrosstalk}>
              Run
            </Button>
          </Flex>
        </Card>

        <Card>
          <Heading size="3">THD</Heading>
          <Flex direction="column" gap="2" mt="3">
            <LabeledTextInput
              label="Tones (Hz, comma-separated)"
              value={thdToneText}
              placeholder="100, 1000, 6000"
              onChange={(event) => onChangeThdToneText(event.target.value)}
            />
            <LabeledNumberInput
              label="Tone Duration (s)"
              value={thdRequest.toneDurationSecs}
              step={0.1}
              onChange={(event) =>
                onChangeThdRequest({
                  ...thdRequest,
                  toneDurationSecs: toNumber(event.target.value, 1)
                })
              }
            />
            <LabeledNumberInput
              label="Amplitude"
              value={thdRequest.amplitude}
              step={0.05}
              min={0}
              max={1}
              onChange={(event) =>
                onChangeThdRequest({
                  ...thdRequest,
                  amplitude: toNumber(event.target.value, 0.6)
                })
              }
            />
            <Button disabled={running} onClick={onRunThd}>
              Run
            </Button>
          </Flex>
        </Card>

        <Card>
          <Heading size="3">Isolation</Heading>
          <Flex direction="column" gap="2" mt="3">
            <LabeledNumberInput
              label="Noise Duration (s)"
              value={isolationRequest.noiseDurationSecs}
              step={0.1}
              onChange={(event) =>
                onChangeIsolation({
                  ...isolationRequest,
                  noiseDurationSecs: toNumber(event.target.value, 2)
                })
              }
            />
            <LabeledNumberInput
              label="Amplitude"
              value={isolationRequest.amplitude}
              step={0.05}
              min={0}
              max={1}
              onChange={(event) =>
                onChangeIsolation({
                  ...isolationRequest,
                  amplitude: toNumber(event.target.value, 0.4)
                })
              }
            />
            <Button disabled={running} onClick={onRunIsolation}>
              Run
            </Button>
          </Flex>
        </Card>
      </div>
    </Card>
  );
}

