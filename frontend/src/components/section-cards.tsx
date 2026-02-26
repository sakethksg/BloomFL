"use client"

import { useEffect, useState } from "react"
import { IconTrendingUp, IconTrendingDown, IconMinus } from "@tabler/icons-react"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { api } from "@/lib/api"
import { useNodes } from "@/hooks/useNodes"
import type { Summary } from "@/lib/types"

export function SectionCards() {
  const { nodes, wsStatus } = useNodes()
  const [summary, setSummary] = useState<Summary | null>(null)

  useEffect(() => {
    api.metrics.summary().then(setSummary).catch(() => {})
    const id = setInterval(() => {
      api.metrics.summary().then(setSummary).catch(() => {})
    }, 10_000)
    return () => clearInterval(id)
  }, [])

  const activeNodes = nodes.filter((n) => n.is_running).length
  const accuracy = summary?.final_mean_accuracy
  const accuracyStd = summary?.final_std_accuracy
  const convergenceRound = summary?.convergence_round
  const totalRounds = summary?.total_rounds ?? 0
  const bytesMb = summary?.total_bytes_mb

  return (
    <div className="grid grid-cols-1 gap-4 px-4 lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
      {/* Active Nodes */}
      <Card className="@container/card border-2 hover:border-primary/50 transition-colors overflow-hidden">
        <CardHeader className="bg-gradient-to-br from-primary/5 to-transparent pb-4">
          <CardDescription className="text-xs font-semibold uppercase tracking-wider">Active Nodes</CardDescription>
          <CardTitle className="text-4xl font-bold tabular-nums @[250px]/card:text-5xl">
            {nodes.length > 0 ? activeNodes : "—"}
          </CardTitle>
          <CardAction className="mt-2">
            <Badge
              variant="outline"
              className={wsStatus === "connected" ? "border-green-500 text-green-600 font-semibold" : ""}
            >
              {wsStatus === "connected" ? "🟢 Live" : "📡 Polling"}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm pt-3 border-t">
          <div className="font-semibold text-foreground">
            {nodes.length} total nodes registered
          </div>
          <div className="text-xs text-muted-foreground">Federated learning peers</div>
        </CardFooter>
      </Card>

      {/* Mean Accuracy */}
      <Card className="@container/card border-2 hover:border-primary/50 transition-colors overflow-hidden">
        <CardHeader className="bg-gradient-to-br from-primary/5 to-transparent pb-4">
          <CardDescription className="text-xs font-semibold uppercase tracking-wider">Mean Accuracy</CardDescription>
          <CardTitle className="text-4xl font-bold tabular-nums @[250px]/card:text-5xl">
            {accuracy != null ? `${(accuracy * 100).toFixed(1)}%` : "—"}
          </CardTitle>
          <CardAction className="mt-2">
            <Badge variant="outline" className="font-semibold">
              {accuracy != null && accuracy > 0.8 ? (
                <><IconTrendingUp className="size-3.5" />{accuracyStd != null ? `±${(accuracyStd * 100).toFixed(1)}%` : "Good"}</>
              ) : accuracy != null ? (
                <><IconMinus className="size-3.5" />Training</>
              ) : (
                <span>Pending</span>
              )}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm pt-3 border-t">
          <div className="font-semibold text-foreground">
            {accuracy != null && accuracy > 0.8
              ? "Above target threshold"
              : "Training in progress"}
          </div>
          <div className="text-xs text-muted-foreground">Across all participating nodes</div>
        </CardFooter>
      </Card>

      {/* Convergence */}
      <Card className="@container/card border-2 hover:border-primary/50 transition-colors overflow-hidden">
        <CardHeader className="bg-gradient-to-br from-primary/5 to-transparent pb-4">
          <CardDescription className="text-xs font-semibold uppercase tracking-wider">Convergence Round</CardDescription>
          <CardTitle className="text-4xl font-bold tabular-nums @[250px]/card:text-5xl">
            {convergenceRound != null ? `R${convergenceRound}` : "Pending"}
          </CardTitle>
          <CardAction className="mt-2">
            <Badge variant="outline" className="font-semibold">
              {convergenceRound != null ? (
                <><IconTrendingUp className="size-3.5" />Converged</>
              ) : (
                <><IconMinus className="size-3.5" />Running</>
              )}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm pt-3 border-t">
          <div className="font-semibold text-foreground">
            {convergenceRound != null
              ? `Converged at round ${convergenceRound}`
              : "Not yet converged"}
          </div>
          <div className="text-xs text-muted-foreground">
            {totalRounds > 0 ? `${totalRounds} rounds completed` : "Waiting for data"}
          </div>
        </CardFooter>
      </Card>

      {/* Gossip Bytes */}
      <Card className="@container/card border-2 hover:border-primary/50 transition-colors overflow-hidden">
        <CardHeader className="bg-gradient-to-br from-primary/5 to-transparent pb-4">
          <CardDescription className="text-xs font-semibold uppercase tracking-wider">Gossip Exchanged</CardDescription>
          <CardTitle className="text-4xl font-bold tabular-nums @[250px]/card:text-5xl">
            {bytesMb != null ? `${bytesMb.toFixed(1)} MB` : "—"}
          </CardTitle>
          <CardAction className="mt-2">
            <Badge variant="outline" className="font-semibold">
              <IconTrendingUp className="size-3.5" />
              P2P
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm pt-3 border-t">
          <div className="font-semibold text-foreground">
            Decentralised parameter sharing
          </div>
          <div className="text-xs text-muted-foreground">Cumulative gossip traffic</div>
        </CardFooter>
      </Card>
    </div>
  )
}

