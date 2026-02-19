import { Button, Card, Flex, Heading, Separator } from "@radix-ui/themes";

type ResultsPageProps = {
  resultText: string;
  logText: string;
  onCopyLog: () => void;
  onClearLog: () => void;
  onClearResults: () => void;
};

export function ResultsPage({
  resultText,
  logText,
  onCopyLog,
  onClearLog,
  onClearResults
}: ResultsPageProps) {
  return (
    <div className="flex flex-col gap-4">
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
        <Flex align="center" justify="between" wrap="wrap" gap="2">
          <Heading size="4">Results / Log</Heading>
          <Flex gap="2">
            <Button variant="soft" onClick={onCopyLog}>
              Copy Log
            </Button>
            <Button variant="soft" onClick={onClearLog}>
              Clear Log
            </Button>
            <Button variant="soft" onClick={onClearResults}>
              Clear Results
            </Button>
          </Flex>
        </Flex>

        <Separator my="3" size="4" />

        <div className="max-h-80 overflow-auto rounded-2xl border border-white/10 bg-black/25 p-3">
          <pre className="whitespace-pre-wrap text-xs text-slate-200">
            {logText.length > 0 ? logText : "No logs yet."}
          </pre>
        </div>
      </Card>
    </div>
  );
}
