import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { Mic, Speaker, RefreshCw } from "lucide-react";

interface Device {
  name: string;
  index: number;
  max_input_channels: number;
  max_output_channels: number;
  default_sample_rate: number;
}

export default function DeviceSelector() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [inputIdx, setInputIdx] = useState<number | null>(null);
  const [outputIdx, setOutputIdx] = useState<number | null>(null);

  const fetchDevices = async () => {
    try {
      const devs: Device[] = await invoke("get_devices");
      setDevices(devs);
    } catch (e) {
      console.error("Failed to fetch devices:", e);
    }
  };

  useEffect(() => {
    fetchDevices();
  }, []);

  const handleSelect = async (idx: number, isInput: boolean) => {
    try {
      await invoke("select_device", { index: idx, isInput });
      if (isInput) setInputIdx(idx);
      else setOutputIdx(idx);
    } catch (e) {
      console.error("Failed to select device:", e);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Audio Devices</h3>
        <button onClick={fetchDevices} className="p-1 hover:bg-secondary rounded-md transition-colors">
          <RefreshCw size={14} className="text-muted-foreground" />
        </button>
      </div>

      <div className="space-y-3">
        <section>
          <div className="flex items-center space-x-2 mb-2 text-xs font-medium">
            <Speaker size={14} /> <span>Output Device</span>
          </div>
          <select 
            className="w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            onChange={(e) => handleSelect(parseInt(e.target.value), false)}
            value={outputIdx ?? ""}
          >
            <option value="" disabled>Select output...</option>
            {devices.filter(d => d.max_output_channels > 0).map(d => (
              <option key={d.index} value={d.index}>{d.name}</option>
            ))}
          </select>
        </section>

        <section>
          <div className="flex items-center space-x-2 mb-2 text-xs font-medium">
            <Mic size={14} /> <span>Input Device</span>
          </div>
          <select 
            className="w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            onChange={(e) => handleSelect(parseInt(e.target.value), true)}
            value={inputIdx ?? ""}
          >
            <option value="" disabled>Select input...</option>
            {devices.filter(d => d.max_input_channels > 0).map(d => (
              <option key={d.index} value={d.index}>{d.name}</option>
            ))}
          </select>
        </section>
      </div>
    </div>
  );
}
