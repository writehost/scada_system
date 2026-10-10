"use client"

import { MeterWizard } from "@/components/ems/meter-wizard"
import { NeedSite } from "@/components/ems/shell"

export default function NewMeterPage() {
  return <NeedSite>{() => <MeterWizard />}</NeedSite>
}
