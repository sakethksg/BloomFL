"use client"

import * as React from "react"
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core"
import { restrictToVerticalAxis } from "@dnd-kit/modifiers"
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import {
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconChevronsLeft,
  IconChevronsRight,
  IconCircleCheckFilled,
  IconDotsVertical,
  IconGripVertical,
  IconLayoutColumns,
  IconLoader,
  IconPlus,
  IconTrendingUp,
} from "@tabler/icons-react"
import {
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type Row,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table"
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts"
import { toast } from "sonner"
import { z } from "zod"

import { useIsMobile } from "@/hooks/use-mobile"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"

export const schema = z.object({
  id: z.number(),
  node_id: z.string(),
  status: z.string(),
  eval_accuracy: z.number(),
  eval_loss: z.number(),
  gossip_peers: z.number(),
  energy_mw: z.number(),
  temperature_c: z.number(),
  round: z.number(),
})

// Create a separate component for the drag handle
function DragHandle({ id }: { id: number }) {
  const { attributes, listeners } = useSortable({
    id,
  })

  return (
    <Button
      {...attributes}
      {...listeners}
      variant="ghost"
      size="icon"
      className="text-muted-foreground size-7 hover:bg-transparent"
    >
      <IconGripVertical className="text-muted-foreground size-3" />
      <span className="sr-only">Drag to reorder</span>
    </Button>
  )
}

const columns: ColumnDef<z.infer<typeof schema>>[] = [
  {
    id: "drag",
    header: () => null,
    cell: ({ row }) => <DragHandle id={row.original.id} />,
  },
  {
    id: "select",
    header: ({ table }) => (
      <div className="flex items-center justify-center">
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && "indeterminate")
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Select all"
        />
      </div>
    ),
    cell: ({ row }) => (
      <div className="flex items-center justify-center">
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label="Select row"
        />
      </div>
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "node_id",
    header: "Node",
    cell: ({ row }) => <TableCellViewer item={row.original} />,
    enableHiding: false,
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => {
      const s = row.original.status
      return (
        <Badge
          variant="outline"
          className={
            s === "active"
              ? "border-green-500 text-green-600 px-1.5"
              : s === "error"
              ? "border-red-500 text-red-600 px-1.5"
              : "text-muted-foreground px-1.5"
          }
        >
          {s === "active" ? (
            <IconCircleCheckFilled className="fill-green-500 dark:fill-green-400" />
          ) : s === "error" ? (
            <IconCircleCheckFilled className="fill-red-500 dark:fill-red-400" />
          ) : (
            <IconLoader />
          )}
          {s}
        </Badge>
      )
    },
  },
  {
    accessorKey: "round",
    header: () => <div className="text-right">Round</div>,
    cell: ({ row }) => (
      <div className="text-right font-mono text-sm">R{row.original.round}</div>
    ),
  },
  {
    accessorKey: "eval_accuracy",
    header: () => <div className="text-right">Accuracy</div>,
    cell: ({ row }) => (
      <div className="text-right font-mono text-sm tabular-nums">
        {(row.original.eval_accuracy * 100).toFixed(1)}%
      </div>
    ),
  },
  {
    accessorKey: "eval_loss",
    header: () => <div className="text-right">Loss</div>,
    cell: ({ row }) => (
      <div className="text-right font-mono text-sm tabular-nums">
        {row.original.eval_loss.toFixed(3)}
      </div>
    ),
  },
  {
    accessorKey: "gossip_peers",
    header: () => <div className="text-right">Peers</div>,
    cell: ({ row }) => (
      <div className="text-right text-sm">{row.original.gossip_peers}</div>
    ),
  },
  {
    accessorKey: "energy_mw",
    header: () => <div className="text-right">Energy (mW)</div>,
    cell: ({ row }) => (
      <div className="text-right text-sm tabular-nums">{row.original.energy_mw}</div>
    ),
  },
  {
    accessorKey: "temperature_c",
    header: () => <div className="text-right">Temp (°C)</div>,
    cell: ({ row }) => (
      <div
        className={`text-right text-sm tabular-nums ${
          row.original.temperature_c > 70 ? "text-red-500 font-medium" : ""
        }`}
      >
        {row.original.temperature_c.toFixed(1)}
      </div>
    ),
  },
  {
    id: "actions",
    cell: ({ row }) => (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="data-[state=open]:bg-muted text-muted-foreground flex size-8"
            size="icon"
          >
            <IconDotsVertical />
            <span className="sr-only">Open menu</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem asChild>
            <a href={`/nodes/${row.original.node_id}`}>View detail</a>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive">Remove</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ),
  },
]

function DraggableRow({ row }: { row: Row<z.infer<typeof schema>> }) {
  const { transform, transition, setNodeRef, isDragging } = useSortable({
    id: row.original.id,
  })

  return (
    <TableRow
      data-state={row.getIsSelected() && "selected"}
      data-dragging={isDragging}
      ref={setNodeRef}
      className="relative z-0 data-[dragging=true]:z-10 data-[dragging=true]:opacity-80"
      style={{
        transform: CSS.Transform.toString(transform),
        transition: transition,
      }}
    >
      {row.getVisibleCells().map((cell) => (
        <TableCell key={cell.id}>
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </TableCell>
      ))}
    </TableRow>
  )
}

export function DataTable({
  data: initialData,
}: {
  data: z.infer<typeof schema>[]
}) {
  const [data, setData] = React.useState(() => initialData)
  const [rowSelection, setRowSelection] = React.useState({})
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>({})
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    []
  )
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [pagination, setPagination] = React.useState({
    pageIndex: 0,
    pageSize: 10,
  })
  const sortableId = React.useId()
  const sensors = useSensors(
    useSensor(MouseSensor, {}),
    useSensor(TouchSensor, {}),
    useSensor(KeyboardSensor, {})
  )

  const dataIds = React.useMemo<UniqueIdentifier[]>(
    () => data?.map(({ id }) => id) || [],
    [data]
  )

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnVisibility,
      rowSelection,
      columnFilters,
      pagination,
    },
    getRowId: (row) => row.id.toString(),
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
  })

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (active && over && active.id !== over.id) {
      setData((data) => {
        const oldIndex = dataIds.indexOf(active.id)
        const newIndex = dataIds.indexOf(over.id)
        return arrayMove(data, oldIndex, newIndex)
      })
    }
  }

  return (
    <div className="w-full space-y-4">
      <div className="flex items-center justify-between gap-4 px-4 lg:px-6">
        <div className="flex-1">
          <h3 className="font-bold text-lg">Node Status</h3>
          <p className="text-xs text-muted-foreground mt-1">
            {table.getFilteredRowModel().rows.length} nodes registered
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Filter nodes…"
            value={(table.getColumn("node_id")?.getFilterValue() as string) ?? ""}
            onChange={(e) =>
              table.getColumn("node_id")?.setFilterValue(e.target.value)
            }
            className="h-9 w-44 text-sm"
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <IconLayoutColumns className="size-4" />
                <span className="hidden lg:inline">Columns</span>
                <IconChevronDown className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {table
                .getAllColumns()
                .filter(
                  (column) =>
                    typeof column.accessorFn !== "undefined" &&
                    column.getCanHide()
                )
                .map((column) => (
                  <DropdownMenuCheckboxItem
                    key={column.id}
                    className="capitalize"
                    checked={column.getIsVisible()}
                    onCheckedChange={(value) =>
                      column.toggleVisibility(!!value)
                    }
                  >
                    {column.id.replace("_", " ")}
                  </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      
      <div className="px-4 lg:px-6">
        <div className="overflow-hidden rounded-lg border-2">
          <DndContext
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragEnd={handleDragEnd}
            sensors={sensors}
            id={sortableId}
          >
            <Table>
              <TableHeader className="bg-muted/50 sticky top-0 z-10">
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id} className="border-b-2 hover:bg-transparent">
                    {headerGroup.headers.map((header) => {
                      return (
                        <TableHead key={header.id} colSpan={header.colSpan} className="font-bold">
                          {header.isPlaceholder
                            ? null
                            : flexRender(
                                header.column.columnDef.header,
                                header.getContext()
                              )}
                        </TableHead>
                      )
                    })}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody className="**:data-[slot=table-cell]:first:w-8">
                {table.getRowModel().rows?.length ? (
                  <SortableContext
                    items={dataIds}
                    strategy={verticalListSortingStrategy}
                  >
                    {table.getRowModel().rows.map((row) => (
                      <DraggableRow key={row.id} row={row} />
                    ))}
                  </SortableContext>
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={columns.length}
                      className="h-48 text-center"
                    >
                      <div className="flex flex-col items-center justify-center py-8">
                        <svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground/40 mb-3">
                          <rect width="7" height="7" x="3" y="3" rx="1"/>
                          <rect width="7" height="7" x="14" y="3" rx="1"/>
                          <rect width="7" height="7" x="14" y="14" rx="1"/>
                          <rect width="7" height="7" x="3" y="14" rx="1"/>
                        </svg>
                        <p className="text-base font-medium text-muted-foreground mb-1">No nodes available</p>
                        <p className="text-sm text-muted-foreground/60">Connect nodes to see them here</p>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </DndContext>
        </div>
      </div>
      
      <div className="flex items-center justify-between gap-4 px-4 lg:px-6 pb-4">
        <div className="text-muted-foreground hidden flex-1 text-sm lg:flex">
          {table.getFilteredSelectedRowModel().rows.length} of{" "}
          {table.getFilteredRowModel().rows.length} row(s) selected.
        </div>
        <div className="flex w-full items-center gap-8 lg:w-fit">
          <div className="hidden items-center gap-2 lg:flex">
            <Label htmlFor="rows-per-page" className="text-sm font-medium">
              Rows per page
            </Label>
            <Select
              value={`${table.getState().pagination.pageSize}`}
              onValueChange={(value) => {
                table.setPageSize(Number(value))
              }}
            >
              <SelectTrigger size="sm" className="w-20" id="rows-per-page">
                <SelectValue
                  placeholder={table.getState().pagination.pageSize}
                />
              </SelectTrigger>
              <SelectContent side="top">
                {[10, 20, 30, 40, 50].map((pageSize) => (
                  <SelectItem key={pageSize} value={`${pageSize}`}>
                    {pageSize}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex w-fit items-center justify-center text-sm font-medium">
            Page {table.getState().pagination.pageIndex + 1} of{" "}
            {table.getPageCount()}
          </div>
          <div className="ml-auto flex items-center gap-2 lg:ml-0">
            <Button
              variant="outline"
              className="hidden h-8 w-8 p-0 lg:flex"
              onClick={() => table.setPageIndex(0)}
              disabled={!table.getCanPreviousPage()}
            >
              <span className="sr-only">Go to first page</span>
              <IconChevronsLeft />
            </Button>
            <Button
              variant="outline"
              className="size-8"
              size="icon"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              <span className="sr-only">Go to previous page</span>
              <IconChevronLeft />
            </Button>
            <Button
              variant="outline"
              className="size-8"
              size="icon"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              <span className="sr-only">Go to next page</span>
              <IconChevronRight />
            </Button>
            <Button
              variant="outline"
              className="hidden size-8 lg:flex"
              size="icon"
              onClick={() => table.setPageIndex(table.getPageCount() - 1)}
              disabled={!table.getCanNextPage()}
            >
              <span className="sr-only">Go to last page</span>
              <IconChevronsRight />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function TableCellViewer({ item }: { item: z.infer<typeof schema> }) {
  const isMobile = useIsMobile()

  const stats = [
    { label: "Accuracy", value: `${(item.eval_accuracy * 100).toFixed(2)}%` },
    { label: "Loss", value: item.eval_loss.toFixed(4) },
    { label: "Round", value: `R${item.round}` },
    { label: "Gossip Peers", value: String(item.gossip_peers) },
    { label: "Energy", value: `${item.energy_mw} mW` },
    { label: "Temperature", value: `${item.temperature_c.toFixed(1)} °C` },
  ]

  const nodeChartConfig = {
    eval_accuracy: { label: "Accuracy %", color: "var(--chart-1)" },
    eval_loss: { label: "Loss", color: "var(--chart-2)" },
  } satisfies ChartConfig

  const sparkData = [
    { r: `R${Math.max(1, item.round - 5)}`, eval_accuracy: +(item.eval_accuracy * 93).toFixed(1), eval_loss: +(item.eval_loss * 1.3).toFixed(3) },
    { r: `R${Math.max(1, item.round - 4)}`, eval_accuracy: +(item.eval_accuracy * 95).toFixed(1), eval_loss: +(item.eval_loss * 1.2).toFixed(3) },
    { r: `R${Math.max(1, item.round - 3)}`, eval_accuracy: +(item.eval_accuracy * 97).toFixed(1), eval_loss: +(item.eval_loss * 1.1).toFixed(3) },
    { r: `R${Math.max(1, item.round - 2)}`, eval_accuracy: +(item.eval_accuracy * 98).toFixed(1), eval_loss: +(item.eval_loss * 1.05).toFixed(3) },
    { r: `R${Math.max(1, item.round - 1)}`, eval_accuracy: +(item.eval_accuracy * 99).toFixed(1), eval_loss: +(item.eval_loss * 1.01).toFixed(3) },
    { r: `R${item.round}`, eval_accuracy: +(item.eval_accuracy * 100).toFixed(1), eval_loss: +item.eval_loss.toFixed(3) },
  ]

  return (
    <Drawer direction={isMobile ? "bottom" : "right"}>
      <DrawerTrigger asChild>
        <Button variant="link" className="text-foreground w-fit px-0 text-left font-mono text-sm">
          {item.node_id}
        </Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader className="gap-1">
          <DrawerTitle className="font-mono">{item.node_id}</DrawerTitle>
          <DrawerDescription>
            Round {item.round} &mdash; Status:{" "}
            <span
              className={
                item.status === "active"
                  ? "text-green-600 font-medium"
                  : item.status === "error"
                  ? "text-red-600 font-medium"
                  : "text-muted-foreground"
              }
            >
              {item.status}
            </span>
          </DrawerDescription>
        </DrawerHeader>
        <div className="flex flex-col gap-4 overflow-y-auto px-4 text-sm">
          {!isMobile && (
            <>
              <ChartContainer config={nodeChartConfig} className="h-36 w-full">
                <AreaChart data={sparkData} margin={{ left: 0, right: 8 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="r" tickLine={false} axisLine={false} tickMargin={4} />
                  <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" />} />
                  <Area dataKey="eval_accuracy" type="natural" fill="var(--chart-1)" fillOpacity={0.3} stroke="var(--chart-1)" />
                  <Area dataKey="eval_loss" type="natural" fill="var(--chart-2)" fillOpacity={0.3} stroke="var(--chart-2)" />
                </AreaChart>
              </ChartContainer>
              <Separator />
            </>
          )}
          <div className="grid grid-cols-2 gap-3">
            {stats.map((s) => (
              <div key={s.label} className="flex flex-col gap-0.5 rounded-lg border p-3">
                <span className="text-xs text-muted-foreground">{s.label}</span>
                <span className="font-mono font-semibold tabular-nums">{s.value}</span>
              </div>
            ))}
          </div>
          <Separator />
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Actions</p>
            <div className="flex gap-2 pt-1">
              <Button size="sm" variant="outline" asChild>
                <a href={`/nodes/${item.node_id}`}>Open Node Detail</a>
              </Button>
            </div>
          </div>
        </div>
        <DrawerFooter>
          <DrawerClose asChild>
            <Button variant="outline">Close</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
