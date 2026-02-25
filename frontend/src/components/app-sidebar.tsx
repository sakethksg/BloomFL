"use client"

import * as React from "react"
import {
  IconDashboard,
  IconServer,
  IconChartBar,
  IconNetwork,
  IconTrendingUp,
  IconPlayerPlay,
  IconSettings,
  IconHelp,
  IconActivity,
  IconScan,
} from "@tabler/icons-react"

import { NavMain } from "@/components/nav-main"
import { NavSecondary } from "@/components/nav-secondary"
import { NavUser } from "@/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

const data = {
  user: {
    name: "BloomFL Admin",
    email: "admin@bloomfl.local",
    avatar: "",
  },
  navMain: [
    { title: "Dashboard", url: "/", icon: IconDashboard },
    { title: "Nodes", url: "/nodes", icon: IconServer },
    { title: "Metrics", url: "/metrics", icon: IconChartBar },
    { title: "Gossip Graph", url: "/gossip", icon: IconNetwork },
    { title: "Convergence", url: "/convergence", icon: IconTrendingUp },
    { title: "Simulation", url: "/simulation", icon: IconPlayerPlay },
    { title: "Detection", url: "/inference", icon: IconScan },
  ],
  navSecondary: [
    { title: "Config", url: "/config", icon: IconSettings },
    { title: "Docs", url: "https://github.com", icon: IconHelp },
  ],
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="data-[slot=sidebar-menu-button]:!p-1.5"
            >
              <a href="/">
                <IconActivity className="size-5 text-primary" />
                <span className="text-base font-semibold">BloomFL</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
        <NavSecondary items={data.navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={data.user} />
      </SidebarFooter>
    </Sidebar>
  )
}


import { NavDocuments } from "@/components/nav-documents"
