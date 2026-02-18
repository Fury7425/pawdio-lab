import { useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { Play, RotateCcw, Zap, AlertCircle } from "lucide-react";

interface LatencyResult {
  delay_ms: number;
  jitter_ms: number;
  success: boolean;
}

export default function LatencyTest() {
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<LatencyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runTest = async () => {
    setIsRunning(true);
    setError(null);
    try {
      const res: LatencyResult = await invoke("run_latency_test");
      setResult(res);
    } catch (e) {
      setError(typeof e === "string" ? e : "Test failed. Check device selection.");
      console.error(e);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="flex flex-col h-full space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Round-Trip Latency</h2>
          <p className="text-muted-foreground text-sm">Measure precise audio delay using cross-correlation</p>
        </div>
        <button 
          onClick={runTest}
          disabled={isRunning}
          className="flex items-center space-x-2 bg-primary hover:bg-primary/90 disabled:opacity-50 text-white px-6 py-2 rounded-lg font-semibold transition-all shadow-lg shadow-primary/20"
        >
          {isRunning ? <RotateCcw className="animate-spin" size={18} /> : <Play size={18} />}
          <span>{isRunning ? "Running Test..." : "Start Test"}</span>
        </button>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="bg-secondary/30 border border-border rounded-xl p-8 flex flex-col items-center justify-center space-y-2">
          <span className="text-muted-foreground text-sm font-medium uppercase tracking-widest">Average Latency</span>
          <div className="text-6xl font-black text-primary tabular-nums">
            {result ? result.delay_ms.toFixed(2) : "--.--"}
            <span className="text-2xl ml-2 font-normal text-muted-foreground">ms</span>
          </div>
        </div>
        
        <div className="bg-secondary/30 border border-border rounded-xl p-8 flex flex-col items-center justify-center space-y-2">
          <span className="text-muted-foreground text-sm font-medium uppercase tracking-widest">Jitter (Variance)</span>
          <div className="text-6xl font-black text-foreground tabular-nums">
            {result ? result.jitter_ms.toFixed(2) : "--.--"}
            <span className="text-2xl ml-2 font-normal text-muted-foreground">ms</span>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-destructive/10 border border-destructive/50 rounded-xl p-4 flex items-center space-x-3 text-destructive">
          <AlertCircle size={18} className="flex-shrink-0" />
          <span className="text-sm">{error}</span>
        </div>
      )}

      <div className="flex-1 bg-black/20 rounded-xl border border-border relative overflow-hidden flex items-center justify-center">
        <div className="absolute top-4 left-4 flex items-center space-x-2 text-xs text-muted-foreground">
          <Zap size={14} /> <span>LIVE CORRELATION GRAPH</span>
        </div>
        <div className="text-muted-foreground text-sm italic">
          Visualization area - Real-time waveform correlation will be rendered here
        </div>
      </div>
    </div>
  );
}
