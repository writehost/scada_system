"use client"

import { useCallback, useEffect, useRef } from "react"

/** Предотвращает setState до mount, после unmount или при смене ключа запроса. */
export function useCellsRequestGuard() {
  const generationRef = useRef(0)
  const mountedRef = useRef(false)

  const nextGeneration = useCallback(() => {
    generationRef.current += 1
    return generationRef.current
  }, [])

  const isCurrent = useCallback(
    (generation: number) => mountedRef.current && generationRef.current === generation,
    []
  )

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      generationRef.current += 1
    }
  }, [])

  return { nextGeneration, isCurrent }
}
