import { Mic, Speaker } from "lucide-react";
import type { AudioDeviceInfo } from "../model";
import { PageKeyEnum } from "../model";
import { usePawdioLabContext } from "../pawdio-context";
import { useActiveInputCalibration } from "../hooks/use-spl-calibration";

type DeviceBarProps = {
  /** The latency test ignores wireless mode, so it says so instead. */
  wirelessIgnored?: boolean;
};

/** "System Default" resolves to the OS default, so show that device. */
function resolveDevice(
  devices: AudioDeviceInfo[] | undefined,
  index: number | null,
  fallbackIndex: number | null | undefined,
): AudioDeviceInfo | undefined {
  const target = index ?? fallbackIndex ?? null;
  return devices?.find((device) => device.index === target);
}

function formatRate(hz: number): string {
  return `${Number((hz / 1000).toFixed(1))} kHz`;
}

/**
 * One-line summary of what a test on this page will play through and record
 * from, so the devices never have to be remembered from another page.
 */
export function DeviceBar({ wirelessIgnored = false }: DeviceBarProps) {
  const ctx = usePawdioLabContext();
  const calibration = useActiveInputCalibration();
  const { settings, inventory } = ctx;
  const output = resolveDevice(
    inventory?.outputs,
    settings.outputDeviceIndex,
    inventory?.defaultOutputIndex,
  );
  const input = resolveDevice(
    inventory?.inputs,
    settings.inputDeviceIndex,
    inventory?.defaultInputIndex,
  );
  const outputName =
    output?.name ?? settings.outputDeviceName ?? "System default";
  const inputName = input?.name ?? settings.inputDeviceName ?? "System default";

  return (
    <div className="device-bar" aria-label="Active devices">
      <span className="device-bar-item" title="Output device">
        <Speaker size={14} aria-hidden="true" />
        <span className="device-bar-name">{outputName}</span>
        {output && `${output.channels}ch · `}
        {formatRate(settings.outputSampleRate)}
      </span>
      <span className="device-bar-sep" aria-hidden="true" />
      <span className="device-bar-item" title="Input device">
        <Mic size={14} aria-hidden="true" />
        <span className="device-bar-name">{inputName}</span>
        {input && `${input.channels}ch · `}
        {formatRate(settings.inputSampleRate)}
      </span>
      {settings.bluetoothMode ? (
        <span
          className="device-badge is-accent"
          title={
            wirelessIgnored
              ? "The latency test measures the link delay, so it does not use wireless alignment"
              : "Timing markers and drift correction are on"
          }
        >
          {wirelessIgnored ? "Wireless mode (not used here)" : "Wireless mode"}
        </span>
      ) : (
        <span className="device-badge is-good">Wired</span>
      )}
      {calibration.calibrated && (
        <span className="device-badge">SPL calibrated</span>
      )}
      <button
        type="button"
        className="skin-btn secondary compact device-bar-change"
        onClick={() => ctx.setActivePage(PageKeyEnum.Devices)}
      >
        Change
      </button>
    </div>
  );
}
