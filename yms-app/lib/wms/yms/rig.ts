export type Point = { x: number; y: number }

export const TRACTOR_LENGTH = 36
export const TRAILER_LENGTH = 58
export const TRACTOR_WIDTH = 14
export const TRAILER_WIDTH = 16

export function pointAlong(origin: Point, heading: number, distance: number): Point {
  return {
    x: origin.x + Math.cos(heading) * distance,
    y: origin.y + Math.sin(heading) * distance,
  }
}

/**
 * Полуприцеп держится за сцепку и смотрит по своему курсу,
 * а не повторяет угол кабины как одна картинка.
 */
export function hitchPose(input: {
  hitch: Point
  tractorHeading: number
  trailerHeading: number
  hasTrailer: boolean
}) {
  const tractorCenter = pointAlong(input.hitch, input.tractorHeading, TRACTOR_LENGTH * 0.28)
  const trailerCenter = input.hasTrailer
    ? pointAlong(input.hitch, input.trailerHeading + Math.PI, TRAILER_LENGTH * 0.46)
    : null
  return { tractorCenter, trailerCenter, fifthWheel: input.hitch }
}

export function headingBetween(from: Point, to: Point): number {
  return Math.atan2(to.y - from.y, to.x - from.x)
}
