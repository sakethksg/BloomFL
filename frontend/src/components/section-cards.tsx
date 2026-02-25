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
    <div className="*:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:shadow-xs lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
      {/* Active Nodes */}
      <Card className="@container/card">
        <CardHeader>
          <CardDescription>Active Nodes</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {nodes.length > 0 ? activeNodes : "—"}
          </CardTitle>
          <CardAction>
            <Badge
              variant="outline"
              className={wsStatus === "connected" ? "border-green-500 text-green-600" : ""}
            >
              {wsStatus === "connected" ? "Live" : "Polling"}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">
            {nodes.length} total nodes registered
          </div>
          <div className="text-muted-foreground">Federated learning peers</div>
        </CardFooter>
      </Card>

      {/* Mean Accuracy */}
      <Card className="@container/card">
        <CardHeader>
          <CardDescription>Mean Accuracy</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {accuracy != null ? `${(accuracy * 100).toFixed(1)}%` : "—"}
          </CardTitle>
          <CardAction>
            <Badge variant="outline">
              {accuracy != null && accuracy > 0.8 ? (
                <><IconTrendingUp />{accuracyStd != null ? `±${(accuracyStd * 100).toFixed(1)}%` : "Good"}</>
              ) : accuracy != null ? (
                <><IconMinus />Training</>
              ) : (
                <span>Pending</span>
              )}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">
            {accuracy != null && accuracy > 0.8
              ? "Above target threshold"
              : "Training in progress"}
          </div>
          <div className="text-muted-foreground">Across all participating nodes</div>
        </CardFooter>
      </Card>

      {/* Convergence */}
      <Card className="@container/card">
        <CardHeader>
          <CardDescription>Convergence Round</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {convergenceRound != null ? `R${convergenceRound}` : "Pending"}
          </CardTitle>
          <CardAction>
            <Badge variant="outline">
              {convergenceRound != null ? (
                <><IconTrendingUp />Converged</>
              ) : (
                <><IconMinus />Running</>
              )}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">
            {convergenceRound != null
              ? `Converged at round ${convergenceRound}`
              : "Not yet converged"}
          </div>
          <div className="text-muted-foreground">
            {totalRounds > 0 ? `${totalRounds} rounds completed` : "Waiting for data"}
          </div>
        </CardFooter>
      </Card>

      {/* Gossip Bytes */}
      <Card className="@container/card">
        <CardHeader>
          <CardDescription>Gossip Exchanged</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {bytesMb != null ? `${bytesMb.toFixed(1)} MB` : "—"}
          </CardTitle>
          <CardAction>
            <Badge variant="outline">
              <IconTrendingUp />
              P2P
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">
            Decentralised parameter sharing
          </div>
          <div className="text-muted-foreground">Cumulative gossip traffic</div>
        </CardFooter>
      </Card>
    </div>
  )
}

