/**
 * Сборка экранов Route без Next (esbuild) для визуальной проверки на стенде:
 * те же клиентские компоненты, тот же API, та же карта.
 */
import { createRoot } from "react-dom/client"
import { RouteDriver } from "@/components/route/driver"
import { RouteDispatch } from "@/components/route/dispatch"
import { RouteEditor } from "@/components/route/editor"

const path = window.location.pathname
const App = path.startsWith("/route/dispatch") ? RouteDispatch : path.startsWith("/route/editor") ? RouteEditor : RouteDriver
createRoot(document.getElementById("root")!).render(<App />)
