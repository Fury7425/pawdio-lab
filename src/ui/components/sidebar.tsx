import { Badge, Button, Card, Flex, Heading, Separator, Text } from "@radix-ui/themes";
import { pageItems, PageKey } from "../model";

type SidebarProps = {
  activePage: PageKey;
  running: boolean;
  onSelectPage: (page: PageKey) => void;
  onRefreshDevices: () => void;
  onStopTest: () => void;
};

export function Sidebar({
  activePage,
  running,
  onSelectPage,
  onRefreshDevices,
  onStopTest
}: SidebarProps) {
  return (
    <Card className="glass-panel rounded-3xl p-3">
      <Flex direction="column" gap="3">
        <div className="px-2 pb-1">
          <Heading size="6">PawdioLab</Heading>
          <Text size="2" color="gray">
            Sidebar layout
          </Text>
        </div>

        <Separator size="4" />

        {pageItems.map((item) => (
          <Button
            key={item.key}
            variant={activePage === item.key ? "solid" : "soft"}
            onClick={() => onSelectPage(item.key)}
          >
            {item.label}
          </Button>
        ))}

        <Separator size="4" />

        <Badge color={running ? "amber" : "green"}>{running ? "Running" : "Idle"}</Badge>

        <Button variant="soft" onClick={onRefreshDevices}>
          Refresh Devices
        </Button>

        <Button color="red" variant="soft" disabled={!running} onClick={onStopTest}>
          Stop Test
        </Button>
      </Flex>
    </Card>
  );
}
