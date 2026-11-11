"use client"

import * as React from "react"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

/** A medium-rounded switch between a few views (All / Mine). One option is always selected. */
function Segmented<T extends string>({
  value,
  onValueChange,
  options,
  ...props
}: Omit<React.ComponentProps<"div">, "onChange" | "defaultValue" | "dir"> & {
  value: T
  onValueChange: (value: T) => void
  options: readonly { value: T; label: React.ReactNode }[]
}) {
  return (
    <ToggleGroup
      type="single"
      data-segmented=""
      spacing={0}
      value={value}
      onValueChange={(next) => {
        if (next) onValueChange(next as T)
      }}
      {...props}
    >
      {options.map((option) => (
        <ToggleGroupItem key={option.value} value={option.value}>
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

export { Segmented }
