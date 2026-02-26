"use client"

import * as React from "react"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"

import { useIsMobile } from "@/hooks/use-mobile"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group"
import { api } from "@/lib/api"
import type { RoundStats } from "@/lib/types"

const chartConfig = {
  eval_accuracy: {
    label: "Accuracy",
    color: "var(--chart-1)",
  },
  eval_loss: {
    label: "Loss",
    color: "var(--chart-2)",
  },
} satisfies ChartConfig

export function ChartAreaInteractive() {
  const isMobile = useIsMobile()
  const [timeRange, setTimeRange] = React.useState("all")
  const [data, setData] = React.useState<RoundStats[]>([])

  React.useEffect(() => {
    if (isMobile) setTimeRange("10")
  }, [isMobile])

  React.useEffect(() => {
    api.metrics.perRound().then(setData).catch(() => {})
    const id = setInterval(() => {
      api.metrics.perRound().then(setData).catch(() => {})
    }, 15_000)
    return () => clearInterval(id)
  }, [])

  const filtered = React.useMemo(() => {
    if (timeRange === "all") return data
    const n = parseInt(timeRange, 10)
    return data.slice(-n)
  }, [data, timeRange])

  const chartData = filtered.map((r) => ({
    round: `R${r.round_num}`,
    eval_accuracy: r.mean_accuracy != null ? parseFloat((r.mean_accuracy * 100).toFixed(2)) : null,
    eval_loss: r.mean_loss != null ? parseFloat(r.mean_loss.toFixed(4)) : null,
  }))

  return (
    <Card className="@container/card">
      <CardHeader className="flex items-center gap-2 space-y-0 border-b py-5 sm:flex-row">
        <div className="grid flex-1 gap-1">
          <CardTitle>Training Progress</CardTitle>
          <CardDescription>
            Mean accuracy &amp; loss across all nodes per round
          </CardDescription>
        </div>
        <ToggleGroup
          type="single"
          value={timeRange}
          onValueChange={(v) => v && setTimeRange(v)}
          variant="outline"
          className="hidden *:data-[slot=toggle-group-item]:!px-4 @[767px]:flex"
        >
          <ToggleGroupItem value="10">10R</ToggleGroupItem>
          <ToggleGroupItem value="30">30R</ToggleGroupItem>
          <ToggleGroupItem value="all">All</ToggleGroupItem>
        </ToggleGroup>
        <Select value={timeRange} onValueChange={setTimeRange}>
          <SelectTrigger
            className="flex w-40 @[767px]:hidden"
            aria-label="Select range"
          >
            <SelectValue placeholder="All rounds" />
          </SelectTrigger>
          <SelectContent className="rounded-xl">
            <SelectItem value="10" className="rounded-lg">Last 10 rounds</SelectItem>
            <SelectItem value="30" className="rounded-lg">Last 30 rounds</SelectItem>
            <SelectItem value="all" className="rounded-lg">All rounds</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        {chartData.length === 0 ? (
          <div className="flex h-[250px] items-center justify-center">
            <div className="flex flex-col items-center justify-center border-2 border-dashed border-muted rounded-lg p-8 max-w-md">
              <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground/40 mb-4">
                <path d="M3 3v18h18"/>
                <path d="m19 9-5 5-4-4-3 3"/>
              </svg>
              <p className="text-base font-semibold text-muted-foreground mb-1">No training data yet</p>
              <p className="text-sm text-muted-foreground/70 text-center">Start a simulation or connect nodes to see training progress</p>
            </div>
          </div>
        ) : (
          <ChartContainer
            config={chartConfig}
            className="aspect-auto h-[250px] w-full"
          >
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="fillAccuracy" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0.1} />
                </linearGradient>
                <linearGradient id="fillLoss" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--chart-2)" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="var(--chart-2)" stopOpacity={0.1} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="round"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={24}
              />
              <YAxis yAxisId="acc" domain={[0, 100]} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} width={40} />
              <YAxis yAxisId="loss" orientation="right" tickLine={false} axisLine={false} width={55} />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    labelFormatter={(v) => v}
                    indicator="dot"
                  />
                }
              />
              <Area
                yAxisId="acc"
                dataKey="eval_accuracy"
                type="natural"
                fill="url(#fillAccuracy)"
                stroke="var(--chart-1)"
                stackId="a"
              />
              <Area
                yAxisId="loss"
                dataKey="eval_loss"
                type="natural"
                fill="url(#fillLoss)"
                stroke="var(--chart-2)"
                stackId="b"
              />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}

