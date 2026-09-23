"use client"

import { createContext, useContext, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react"

type CloseCtx = { close: () => void }
const CloseContext = createContext<CloseCtx>({ close: () => undefined })

export function Button({
  className = "",
  variant,
  size,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "outline"; size?: "sm" | "default" }) {
  const tone = variant === "outline" ? "yms-btn outline" : "yms-btn"
  const scale = size === "sm" ? " sm" : ""
  return <button className={`${tone}${scale} ${className}`} {...props} />
}

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`yms-input ${className}`} {...props} />
}

export function Dialog({
  open,
  onOpenChange,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
}) {
  if (!open) return null
  return (
    <CloseContext.Provider value={{ close: () => onOpenChange(false) }}>
      <div className="yms-overlay" onMouseDown={() => onOpenChange(false)}>
        {children}
      </div>
    </CloseContext.Provider>
  )
}

export function DialogContent({ children }: { children: ReactNode }) {
  return (
    <div className="yms-modal" onMouseDown={(event) => event.stopPropagation()}>
      {children}
    </div>
  )
}

export function DialogHeader({ children }: { children: ReactNode }) {
  return <div className="yms-modal-head">{children}</div>
}

export function DialogTitle({ children }: { children: ReactNode }) {
  return <h2 className="yms-modal-title">{children}</h2>
}

export function Sheet({
  open,
  onOpenChange,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
}) {
  if (!open) return null
  return (
    <CloseContext.Provider value={{ close: () => onOpenChange(false) }}>
      <div className="yms-overlay" onMouseDown={() => onOpenChange(false)}>
        {children}
      </div>
    </CloseContext.Provider>
  )
}

export function SheetContent({ children, className = "" }: { children: ReactNode; className?: string }) {
  const { close } = useContext(CloseContext)
  return (
    <aside className={`yms-sheet ${className}`} onMouseDown={(event) => event.stopPropagation()}>
      <button type="button" className="yms-sheet-close" onClick={close}>
        Закрыть
      </button>
      {children}
    </aside>
  )
}

export function SheetHeader({ children }: { children: ReactNode }) {
  return <div>{children}</div>
}

export function SheetTitle({ children }: { children: ReactNode }) {
  return <h2 className="yms-modal-title">{children}</h2>
}
