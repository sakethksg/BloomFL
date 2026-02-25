"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { NodeState } from "@/lib/types";

const ENERGY_COLORS: Record<string, string> = {
  HIGH: "bg-green-100 text-green-800 border-green-200",
  MEDIUM: "bg-yellow-100 text-yellow-800 border-yellow-200",
  LOW: "bg-orange-100 text-orange-800 border-orange-200",
  CRITICAL: "bg-red-100 text-red-800 border-red-200",
  UNKNOWN: "bg-gray-100 text-gray-600 border-gray-200",
};

const THERMAL_COLORS: Record<string, string> = {
  NORMAL: "bg-green-100 text-green-800 border-green-200",
  WARM: "bg-yellow-100 text-yellow-800 border-yellow-200",
  HOT: "bg-orange-100 text-orange-800 border-orange-200",
  CRITICAL: "bg-red-100 text-red-800 border-red-200",
  UNKNOWN: "bg-gray-100 text-gray-600 border-gray-200",
};

export function EnergyBadge({ state }: { state: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border",
        ENERGY_COLORS[state] ?? ENERGY_COLORS.UNKNOWN
      )}
    >
      {state}
    </span>
  );
}

export function ThermalBadge({ state }: { state: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border",
        THERMAL_COLORS[state] ?? THERMAL_COLORS.UNKNOWN
      )}
    >
      {state}
    </span>
  );
}

export function StatusDot({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        "inline-block w-2 h-2 rounded-full",
        active ? "bg-green-500 animate-pulse" : "bg-gray-400"
      )}
    />
  );
}

export function fmt(n: number | null | undefined, decimals = 3): string {
  if (n == null) return "—";
  return n.toFixed(decimals);
}

export function fmtPct(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

export function fmtBytes(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
