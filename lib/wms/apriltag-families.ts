import { TAG16H5_CODES } from "./apriltag-tag16h5-codes"
import { TAG25H9_CODES } from "./apriltag-tag25h9-codes"
import { TAG36H10_CODES } from "./apriltag-tag36h10-codes"
import { TAG36H11_CODES } from "./apriltag-tag36h11-codes"

export const APRILTAG_BORDER = 1
export const APRILTAG_FAMILY_IDS = ["tag16h5", "tag25h9", "tag36h10", "tag36h11"] as const
export type AprilTagFamilyId = (typeof APRILTAG_FAMILY_IDS)[number]

export type AprilTagFamilyDef = {
  id: AprilTagFamilyId
  bits: number
  hamming: number
  dataSize: number
  tagCells: number
  maxId: number
  count: number
  warehouse: boolean
  filePrefix: string
  codes: readonly bigint[]
}

export type AprilTagFamilyInfo = Omit<AprilTagFamilyDef, "codes" | "filePrefix">

function defineFamily(
  id: AprilTagFamilyId,
  bits: number,
  hamming: number,
  codes: readonly bigint[],
  warehouse: boolean
): AprilTagFamilyDef {
  const dataSize = Math.round(Math.sqrt(bits))
  return {
    id,
    bits,
    hamming,
    dataSize,
    tagCells: dataSize + APRILTAG_BORDER * 2,
    maxId: codes.length - 1,
    count: codes.length,
    warehouse,
    filePrefix: `tag${bits}_${String(hamming).padStart(2, "0")}`,
    codes,
  }
}

export const APRILTAG_FAMILIES: Record<AprilTagFamilyId, AprilTagFamilyDef> = {
  tag16h5: defineFamily("tag16h5", 16, 5, TAG16H5_CODES, false),
  tag25h9: defineFamily("tag25h9", 25, 9, TAG25H9_CODES, false),
  tag36h10: defineFamily("tag36h10", 36, 10, TAG36H10_CODES, false),
  tag36h11: defineFamily("tag36h11", 36, 11, TAG36H11_CODES, true),
}

export const APRILTAG_FAMILY: AprilTagFamilyId = "tag36h11"
export const APRILTAG_MAX_ID = APRILTAG_FAMILIES.tag36h11.maxId
export const APRILTAG_DATA_SIZE = APRILTAG_FAMILIES.tag36h11.dataSize
export const APRILTAG_TAG_CELLS = APRILTAG_FAMILIES.tag36h11.tagCells

export function isAprilTagFamilyId(raw: unknown): raw is AprilTagFamilyId {
  return typeof raw === "string" && raw in APRILTAG_FAMILIES
}

export function resolveFamily(raw?: string | null): AprilTagFamilyDef {
  const key = (raw ?? "").trim() || APRILTAG_FAMILY
  if (!isAprilTagFamilyId(key)) {
    throw new Error(`AprilTag: неизвестная семья «${key}». Доступны ${APRILTAG_FAMILY_IDS.join(", ")}`)
  }
  return APRILTAG_FAMILIES[key]
}

export function listAprilTagFamilies(): AprilTagFamilyInfo[] {
  return APRILTAG_FAMILY_IDS.map((id) => {
    const family = APRILTAG_FAMILIES[id]
    return {
      id: family.id,
      bits: family.bits,
      hamming: family.hamming,
      dataSize: family.dataSize,
      tagCells: family.tagCells,
      maxId: family.maxId,
      count: family.count,
      warehouse: family.warehouse,
    }
  })
}
