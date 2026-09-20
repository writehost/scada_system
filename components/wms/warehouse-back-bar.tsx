"use client"

import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function WarehouseBackBar({
  href,
  label,
  className,
}: {
  href: string
  label: string
  className?: string
}) {
  return (
    <Button variant="outline" size="sm" className={cn("rounded-lg", className)} asChild>
      <Link href={href}>
        <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
        {label}
      </Link>
    </Button>
  )
}
