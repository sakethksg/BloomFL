"use client";

import { useEffect, useState } from "react";
import { ChartAreaInteractive } from "@/components/chart-area-interactive";
import { DataTable } from "@/components/data-table";
import { SectionCards } from "@/components/section-cards";
import { api } from "@/lib/api";
import type { NodeState } from "@/lib/types";
import { Activity, ShieldAlert, Cpu } from "lucide-react"; // Optional: For some visual flair

function nodesToTableData(nodes: NodeState[]) {
  return nodes.map((n, idx) => ({
    id: idx + 1,
    node_id: n.node_id,
    status: !n.is_running ? "idle" : n.energy_state === "CRITICAL" ? "error" : "active",
    eval_accuracy: n.eval_accuracy ?? 0,
    eval_loss: n.eval_loss ?? 0,
    gossip_peers: n.peer_count,
    energy_mw: n.cpu_percent != null ? Math.round(n.cpu_percent * 6) : 0,
    temperature_c: n.cpu_temperature_c ?? 0,
    round: n.round,
  }));
}

export default function DashboardPage() {
  const [tableData, setTableData] = useState<ReturnType<typeof nodesToTableData>>([]);

  useEffect(() => {
    const load = () =>
      api.nodes.list()
        .then((ns) => setTableData(nodesToTableData(ns)))
        .catch(() => {});
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="min-h-screen bg-slate-50/50 p-4 lg:p-8">
      {/* CONTAINER: Setting a max-width prevents the 
          "stretched" look on large monitors. 
      */}
      <div className="mx-auto max-w-[1400px] space-y-8">
        
        {/* HEADER AREA */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">Network Dashboard</h1>
            <p className="text-slate-500 mt-1">Real-time federated learning orchestration and node metrics.</p>
          </div>
          <div className="flex items-center gap-2 px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-medium w-fit">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
            </span>
            System Live
          </div>
        </div>

        {/* TOP METRICS: SectionCards usually contains 4 cards. 
            We wrap it in a grid to control the span. */}
        <section className="">
          <SectionCards />
        </section>

        {/* MAIN VISUALIZATION AREA: 12-column Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* CHART: Spans 8 columns (2/3rd of the width) */}
          <div className="lg:col-span-8 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-100 bg-slate-50/50">
              <h3 className="font-semibold text-slate-700">Training Performance</h3>
            </div>
            <div className="p-2">
               <ChartAreaInteractive />
            </div>
          </div>

          {/* SIDEBAR STATS: Spans 4 columns (1/3rd of the width) */}
          <div className="lg:col-span-4 flex flex-col gap-6">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
              <h3 className="font-semibold text-slate-700 mb-4 flex items-center gap-2">
                <Activity className="h-4 w-4 text-blue-500" />
                Network Health
              </h3>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-500">Avg. Latency</span>
                  <span className="text-sm font-mono font-medium">12ms</span>
                </div>
                <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                  <div className="bg-blue-500 h-full w-[85%]"></div>
                </div>
                
                <div className="flex justify-between items-center pt-2">
                  <span className="text-sm text-slate-500">Packet Loss</span>
                  <span className="text-sm font-mono font-medium text-green-600">0.02%</span>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
              <h3 className="font-semibold text-slate-700 mb-4 flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-orange-500" />
                Alerts
              </h3>
              <div className="text-sm text-slate-600 space-y-3">
                <p className="flex items-start gap-2 bg-orange-50 p-2 rounded border border-orange-100">
                  <span className="font-bold text-orange-700 underline">Node-002:</span> 
                  High thermal load detected (73.4°C).
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* DATA TABLE AREA */}
        <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-semibold text-slate-700 flex items-center gap-2">
              <Cpu className="h-4 w-4 text-indigo-500" />
              Node Inventory
            </h3>
            <span className="text-xs text-slate-400 font-medium px-2 py-1 bg-slate-100 rounded">
              {tableData.length} Nodes Registered
            </span>
          </div>
          <div className="p-0">
             <DataTable data={tableData} />
          </div>
        </section>

      </div>
    </div>
  );
}