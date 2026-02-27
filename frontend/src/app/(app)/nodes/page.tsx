"use client";

import { useNodes } from "@/hooks/useNodes";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  EnergyBadge,
  ThermalBadge,
  StatusDot,
  fmtPct,
  fmt,
} from "@/components/shared/NodeBadges";
import Link from "next/link";

export default function NodesPage() {
  const { nodes, loading } = useNodes();

  return (
    <div className="space-y-6 px-4 lg:px-6 py-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Nodes</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Live state for every reporting node
        </p>
      </div>

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : nodes.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-muted py-24 text-center gap-3">
          <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground/40 mb-2">
            <rect width="7" height="7" x="3" y="3" rx="1"/>
            <rect width="7" height="7" x="14" y="3" rx="1"/>
            <rect width="7" height="7" x="14" y="14" rx="1"/>
            <rect width="7" height="7" x="3" y="14" rx="1"/>
          </svg>
          <p className="text-base font-semibold text-muted-foreground">No nodes reporting yet</p>
          <p className="text-sm text-muted-foreground/70 max-w-md">
            Start a simulation to spawn nodes, or run a BloomFL node manually to see live data here.
          </p>
          <Link href="/simulation" className="mt-2 text-sm text-primary hover:text-primary/80 font-medium underline underline-offset-4">Go to Simulation →</Link>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Node ID</TableHead>
                <TableHead>Round</TableHead>
                <TableHead>Energy</TableHead>
                <TableHead>Thermal</TableHead>
                <TableHead>Battery</TableHead>
                <TableHead>CPU Temp</TableHead>
                <TableHead>CPU %</TableHead>
                <TableHead>Peers</TableHead>
                <TableHead>Accuracy</TableHead>
                <TableHead>Loss</TableHead>
                <TableHead>Gossip</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {nodes.map((node) => (
                <TableRow key={node.node_id}>
                  <TableCell>
                    <Link
                      href={`/nodes/${node.node_id}`}
                      className="font-mono text-xs text-primary hover:underline"
                    >
                      {node.node_id}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm">{node.round}</TableCell>
                  <TableCell>
                    <EnergyBadge state={node.energy_state} />
                  </TableCell>
                  <TableCell>
                    <ThermalBadge state={node.thermal_state} />
                  </TableCell>
                  <TableCell className="text-sm">
                    {node.battery_percent != null
                      ? `${node.battery_percent.toFixed(0)}%${node.is_plugged ? " ⚡" : ""}`
                      : "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {node.cpu_temperature_c != null
                      ? `${node.cpu_temperature_c.toFixed(1)}°C`
                      : "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {node.cpu_percent != null
                      ? `${node.cpu_percent.toFixed(0)}%`
                      : "—"}
                  </TableCell>
                  <TableCell className="text-sm">{node.peer_count}</TableCell>
                  <TableCell className="text-sm">
                    {fmtPct(node.eval_accuracy)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {fmt(node.eval_loss)}
                  </TableCell>
                  <TableCell>
                    <StatusDot active={!!node.gossip_enabled} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
