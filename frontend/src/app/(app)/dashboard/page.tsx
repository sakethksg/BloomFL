"use client";

import { useEffect, useState } from "react";
import { ChartAreaInteractive } from "@/components/chart-area-interactive";
import { DataTable } from "@/components/data-table";
import { SectionCards } from "@/components/section-cards";
import { api } from "@/lib/api";
import type { NodeState } from "@/lib/types";

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
      api.nodes.list().then((ns) => setTableData(nodesToTableData(ns))).catch(() => {});
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex flex-1 flex-col">
      <div className="@container/main flex flex-1 flex-col gap-4">
        <div className="flex flex-col gap-6 px-4 lg:px-6 py-6">
          <SectionCards />
          <div>
            <ChartAreaInteractive />
          </div>
          <div>
            <DataTable data={tableData} />
          </div>
        </div>
      </div>
    </div>
  );
}
