"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Server,
  BarChart2,
  GitBranch,
  TrendingUp,
  Play,
  Settings,
  Wifi,
  WifiOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useWebSocket } from "@/hooks/useWebSocket";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/nodes", label: "Nodes", icon: Server },
  { href: "/metrics", label: "Metrics", icon: BarChart2 },
  { href: "/gossip", label: "Gossip Graph", icon: GitBranch },
  { href: "/convergence", label: "Convergence", icon: TrendingUp },
  { href: "/simulation", label: "Simulation", icon: Play },
  { href: "/config", label: "Config", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const { status } = useWebSocket("nodes");

  return (
    <aside className="flex flex-col w-64 min-h-screen bg-sidebar border-r border-border shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-2 px-6 py-5 border-b border-border">
        <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-bold text-sm">
          B
        </div>
        <span className="font-semibold text-base tracking-tight">BloomFL</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active =
            href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* WS status badge */}
      <div className="px-4 py-4 border-t border-border">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {status === "connected" ? (
            <Wifi className="w-3 h-3 text-green-500" />
          ) : (
            <WifiOff className="w-3 h-3 text-destructive" />
          )}
          <span>
            {status === "connected"
              ? "Live"
              : status === "connecting"
              ? "Connecting…"
              : "Disconnected"}
          </span>
          <span
            className={cn(
              "ml-auto w-2 h-2 rounded-full",
              status === "connected"
                ? "bg-green-500 animate-pulse"
                : "bg-muted-foreground"
            )}
          />
        </div>
      </div>
    </aside>
  );
}
