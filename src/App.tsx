import React from "react";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "./components/ui/Tabs";
import DeviceSelector from "./components/DeviceSelector";
import LatencyTest from "./components/LatencyTest";
import { Activity, Zap, BarChart3 } from "lucide-react";

export default function App() {
  return (
    <div className="flex flex-col h-screen w-full bg-background p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Pawdio Lab</h1>
          <p className="text-muted-foreground text-sm">
            Windows 11 High-Performance Audio Engine
          </p>
        </div>
      </header>

      <div className="grid grid-cols-12 gap-6 flex-1 overflow-hidden">
        <aside className="col-span-3 space-y-6 overflow-y-auto pr-2">
          <DeviceSelector />
        </aside>

        <main className="col-span-9 bg-card rounded-xl border border-border overflow-hidden flex flex-col shadow-2xl">
          <Tabs defaultValue="latency" className="flex flex-col h-full">
            <div className="px-4 pt-4 border-b border-border">
              <TabsList className="bg-muted/50 p-1 rounded-lg inline-flex">
                <TabsTrigger
                  value="latency"
                  className="flex items-center space-x-2"
                >
                  <Zap size={16} /> <span>Latency</span>
                </TabsTrigger>
                <TabsTrigger
                  value="sweep"
                  className="flex items-center space-x-2"
                >
                  <Activity size={16} /> <span>Frequency Sweep</span>
                </TabsTrigger>
                <TabsTrigger
                  value="analysis"
                  className="flex items-center space-x-2"
                >
                  <BarChart3 size={16} /> <span>Spectral Analysis</span>
                </TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="latency" className="mt-0 flex-1">
              <LatencyTest />
            </TabsContent>
            <TabsContent value="sweep" className="mt-0">
              <div className="flex items-center justify-center h-full text-muted-foreground italic">
                Frequency Sweep module implementation...
              </div>
            </TabsContent>
          </Tabs>
        </main>
      </div>
    </div>
  );
}
