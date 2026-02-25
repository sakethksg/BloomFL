"use client"

import { usePathname } from "next/navigation"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Badge } from "@/components/ui/badge"
import { useWebSocket } from "@/hooks/useWebSocket"

const PAGE_TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/nodes": "Nodes",
  "/metrics": "Training Metrics",
  "/gossip": "Gossip Graph",
  "/convergence": "Convergence",
  "/simulation": "Simulation",
  "/config": "Configuration",
}

export function SiteHeader() {
  const pathname = usePathname()
  const { status } = useWebSocket("nodes")

  const title =
    PAGE_TITLES[pathname] ??
    (pathname.startsWith("/nodes/") ? "Node Detail" : "BloomFL")

  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 data-[orientation=vertical]:h-4"
        />
        <h1 className="text-base font-medium">{title}</h1>
        <div className="ml-auto flex items-center gap-2">
          <Badge
            variant="outline"
            className={
              status === "connected"
                ? "border-green-500 text-green-600 text-xs"
                : "text-xs text-muted-foreground"
            }
          >
            <span
              className={
                status === "connected"
                  ? "mr-1.5 size-1.5 rounded-full bg-green-500 inline-block animate-pulse"
                  : "mr-1.5 size-1.5 rounded-full bg-muted-foreground inline-block"
              }
            />
            {status === "connected" ? "Live" : "Offline"}
          </Badge>
        </div>
      </div>
    </header>
  )
}
