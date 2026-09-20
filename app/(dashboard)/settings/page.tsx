"use client"

import { useEffect, useMemo, useState } from "react"
import { 
  Settings,
  User,
  Building2,
  Bell,
  Shield,
  Database,
  Palette,
  Globe,
  Save,
  RefreshCw,
  Plus,
  BookOpen,
  KeyRound,
  Trash2,
  FileText,
} from "lucide-react"
import { authRequestHeaders } from "@/lib/auth/client-token"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import {
  createWmsUser,
  deleteWmsUser,
  getBackendBase,
  getSiteCode,
  getWarehouseOccupancy,
  listNotifications,
  listUsers,
  markNotificationRead,
  setBackendBase,
  setSiteCode,
  updateWmsUser,
  type WmsNotificationRow,
  type WmsUserRow,
} from "@/lib/wms-api"
import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { SettingsDirectoriesWarehouses } from "@/components/wms/settings-directories-warehouses"
import { OneCTransferSyncPanel } from "@/components/wms/one-c-transfer-sync-panel"
import { SettingsApiTokensPanel } from "@/components/wms/settings-api-tokens-panel"
import { SettingsDirectoriesZones } from "@/components/wms/settings-directories-zones"
import { SettingsDirectoriesWorkshops } from "@/components/wms/settings-directories-workshops"
import { SettingsDirectoriesUsers } from "@/components/wms/settings-directories-users"
import { SettingsDirectoriesPackagingNom } from "@/components/wms/settings-directories-packaging-nom"
import { SettingsDirectoriesCellProfile } from "@/components/wms/settings-directories-cell-profile"
import { SettingsDirectoriesIssueRecipients } from "@/components/wms/settings-directories-issue-recipients"
import { SettingsDirectoriesProductionLines } from "@/components/wms/settings-directories-production-lines"
import { SettingsDirectoriesSuppliers } from "@/components/wms/settings-directories-suppliers"
import { SettingsDirectoriesRacks } from "@/components/wms/settings-directories-racks"
import { SettingsDirectoriesItemGroupsUom } from "@/components/wms/settings-directories-item-groups-uom"
import { SettingsDirectoriesItemClasses } from "@/components/wms/settings-directories-item-classes"
import { SettingsDirectoriesReceivingCategories } from "@/components/wms/settings-directories-receiving-categories"
import { SettingsQrVisual } from "@/components/wms/settings-qr-visual"
import { SettingsCellLabelTemplate } from "@/components/wms/settings-cell-label-template"
import { SettingsTorg1Template } from "@/components/wms/settings-torg1-template"
import { SettingsTorg16Template } from "@/components/wms/settings-torg16-template"
import { SettingsDirectoriesWriteoffReasons } from "@/components/wms/settings-directories-writeoff-reasons"
import { SettingsDirectoriesShipRules } from "@/components/wms/settings-directories-ship-rules"
import { WmsErrorState, WmsLoadingState, WmsTableSkeleton } from "@/components/wms/wms-shared"
import { SettingsSecurityPanel } from "@/components/wms/settings-security-panel"
import { ExpiryProductMailSettings } from "@/components/wms/expiry-product-mail-settings"

const WMS_ROLE_OPTIONS = [
  { code: "god", label: "Бог" },
  { code: "admin", label: "Администратор" },
  { code: "warehouse_manager", label: "Начальник склада" },
  { code: "warehouse_operator", label: "Кладовщик" },
  { code: "line_operator", label: "Оператор линии" },
  { code: "auditor", label: "Ревизор" },
] as const

const settingsSections = [
  { id: "profile", title: "Профиль", icon: User, description: "Личные данные и пользователи" },
  { id: "directories", title: "Справочники", icon: BookOpen, description: "Склады, группы, подгруппы приёмки" },
  { id: "company", title: "Организация", icon: Building2, description: "Площадка и сводка склада" },
  { id: "updates", title: "Обновления", icon: RefreshCw, description: "Проверка и установка WMS" },
  { id: "notifications", title: "Уведомления", icon: Bell, description: "Просрочка на почту и in-app" },
  { id: "security", title: "Безопасность", icon: Shield, description: "Scada ID, пароль и доступ" },
  { id: "integrations", title: "Интеграции", icon: Database, description: "база данных, 1С, CRPT, QPass, сервер обновлений" },
  { id: "appearance", title: "Внешний вид", icon: Palette, description: "QR и шаблон этикетки ячейки" },
  { id: "documents", title: "Документы", icon: FileText, description: "Шаблоны ТОРГ-1 и ТОРГ-16" },
  { id: "language", title: "Язык и регион", icon: Globe, description: "Локализация" },
]

type DirectoryTabId =
  | "warehouses"
  | "zones"
  | "workshops"
  | "users"
  | "recipients"
  | "productionLines"
  | "suppliers"
  | "racks"
  | "itemGroups"
  | "itemClasses"
  | "receivingCategories"
  | "packagingNom"
  | "cellProfile"
  | "writeoffReasons"
  | "shipRules"

const directoryTabGroups: Array<{
  title: string
  tabs: Array<{ id: DirectoryTabId; title: string; hint: string }>
}> = [
  {
    title: "Операции",
    tabs: [
      { id: "receivingCategories", title: "Подгруппы приёмки", hint: "Стикеры отдельно, бутылки отдельно" },
      { id: "suppliers", title: "Контрагенты", hint: "Поставщики материалов" },
      { id: "recipients", title: "Получатели выдачи", hint: "Куда уходит товар" },
      { id: "writeoffReasons", title: "Основания списания", hint: "Для операции списания из ячейки" },
      { id: "shipRules", title: "Отгрузка контрагентам", hint: "Слои, свежесть, Пятёрочка" },
    ],
  },
  {
    title: "Номенклатура",
    tabs: [
      { id: "itemGroups", title: "Группы товаров и ЕИ", hint: "Вода, стикеры, сырьё" },
      { id: "itemClasses", title: "Классы S1–S5", hint: "Мелкоштучный, сырьё, ГП…" },
      { id: "packagingNom", title: "Упаковка и типы", hint: "Профили и виды номенклатуры" },
    ],
  },
  {
    title: "Склад",
    tabs: [
      { id: "warehouses", title: "Склады", hint: "Адресное хранение" },
      { id: "zones", title: "Зоны", hint: "LINE, ST-SER и участки склада" },
      { id: "racks", title: "Стеллажи", hint: "Ячейки и QR стеллажа" },
      { id: "workshops", title: "Цехи", hint: "Производственные зоны" },
      { id: "productionLines", title: "Линии производства", hint: "Sipa, JR, Devin — расход в Цехе" },
      { id: "cellProfile", title: "Поля ячеек", hint: "Справочник профиля слота" },
    ],
  },
  {
    title: "Доступ",
    tabs: [{ id: "users", title: "Пользователи WMS", hint: "Вход на сайт и ТСД" }],
  },
]

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState("profile")
  const [directoryTab, setDirectoryTab] = useState<DirectoryTabId>("receivingCategories")
  const [notifications, setNotifications] = useState({
    email: true,
    push: true,
    tasks: true,
    reports: false,
  })
  const [wmsSiteCode, setWmsSiteCode] = useState(() => getSiteCode())
  const [backendBase, setBackendBaseValue] = useState(() => getBackendBase())
  const [savedHint, setSavedHint] = useState<string | null>(null)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [sessionRoleCodes, setSessionRoleCodes] = useState<string[]>([])
  const [users, setUsers] = useState<WmsUserRow[]>([])
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [orgLoading, setOrgLoading] = useState(false)
  const [orgError, setOrgError] = useState<string | null>(null)
  const [orgSummary, setOrgSummary] = useState<{
    siteCode: string
    zones: number
    locationCount: number
    nonEmptyCount: number
    emptyCount: number
    totalAvailableQty: number
  } | null>(null)
  const [inAppNotifications, setInAppNotifications] = useState<WmsNotificationRow[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [notifLoading, setNotifLoading] = useState(false)
  const [notifError, setNotifError] = useState<string | null>(null)
  const [createUserOpen, setCreateUserOpen] = useState(false)
  const [createUserLoading, setCreateUserLoading] = useState(false)
  const [createUserError, setCreateUserError] = useState<string | null>(null)
  const [createUserForm, setCreateUserForm] = useState({
    login: "",
    displayName: "",
    password: "",
    position: "",
    phone: "",
    externalCode: "",
    roleCodes: ["warehouse_operator"] as string[],
  })
  const [passwordUser, setPasswordUser] = useState<WmsUserRow | null>(null)
  const [passwordValue, setPasswordValue] = useState("")
  const [passwordLoading, setPasswordLoading] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null)
  const [updateChecking, setUpdateChecking] = useState(false)
  const [updateApplying, setUpdateApplying] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<string | null>(null)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [updateInfo, setUpdateInfo] = useState<{
    local?: { buildId: string; builtAt?: string | null }
    updateAvailable: boolean
    serverConfigured?: boolean
    remoteError?: string | null
    release?: {
      version: string
      buildId: string
      builtAt: string
      changelog: string
      packageUrl?: string | null
      packageName?: string | null
      mandatory?: boolean
    } | null
    tsd?: {
      updateAvailable: boolean
      error?: string | null
      release?: {
        versionCode: number
        versionName: string
        buildId: string
        builtAt?: string | null
        changelog?: string | null
        apkSha256?: string | null
      } | null
    } | null
  } | null>(null)
  const [integrationsLoading, setIntegrationsLoading] = useState(false)
  const [integrationsSaving, setIntegrationsSaving] = useState(false)
  const [integrationsTesting, setIntegrationsTesting] = useState(false)
  const [integrationsError, setIntegrationsError] = useState<string | null>(null)
  const [integrationsSaved, setIntegrationsSaved] = useState<string | null>(null)
  const [oneCTestResult, setOneCTestResult] = useState<string | null>(null)
  const [dbTestResult, setDbTestResult] = useState<string | null>(null)
  const [dbTesting, setDbTesting] = useState(false)
  const [integrationSettings, setIntegrationSettings] = useState({
    updateServer: {
      url: "https://scada25.ru",
      token: "",
      tokenConfigured: false,
      insecureTls: true,
    },
    oneC: {
      enabled: false,
      baseUrl: "",
      login: "",
      password: "",
      viaFactory: true,
      passwordConfigured: false,
    },
    crpt: {
      configured: false,
      note: "Данные подключения CRPT/Честный Знак сейчас читаются из .env / .env.local: WMS_CRPT_BEARER_TOKEN.",
    },
    qpass: {
      origin: "https://qpass.scada25.ru",
      token: "",
      tokenConfigured: false,
      ensureUrl: "",
    },
    database: {
      mode: "tunnel" as "tunnel" | "direct",
      remoteHost: "127.0.0.1",
      remotePort: "5432",
      appHost: "127.0.0.1",
      appPort: "15432",
      host: "127.0.0.1",
      port: "5432",
      database: "wms_edge",
      user: "postgres",
      password: "",
      passwordConfigured: false,
      sslmode: "disable" as "disable" | "require" | "prefer",
      source: "env",
      urlPreview: "",
      tunnel: {
        sshHost: "127.0.0.1",
        sshPort: "13022",
        sshUser: "wms-deploy",
        label: "завод через FRP/SSH",
      },
      live: null as null | {
        ok: boolean
        address: string
        port: string
        version: string
        database: string
        message: string
      },
    },
  })

  const isAdmin = useMemo(() => {
    const roles = new Set(sessionRoleCodes || [])
    return roles.has("admin")
  }, [sessionRoleCodes])

  function selectDirectoryTab(tab: DirectoryTabId) {
    setDirectoryTab(tab)
    if (typeof window === "undefined") return
    const q = new URLSearchParams(window.location.search)
    q.set("section", "directories")
    q.set("dirTab", tab)
    window.history.replaceState(null, "", `/settings?${q.toString()}`)
  }

  const visibleSettingsSections = useMemo(
    () => settingsSections.filter((section) => section.id !== "integrations" || isAdmin),
    [isAdmin]
  )

  async function reloadUsersOnly() {
    try {
      const userList = await listUsers()
      setUsers(userList.users || [])
    } catch {
      /* ignore — основная ошибка уже в profileError при первой загрузке */
    }
  }

  function saveWmsSettings() {
    setSiteCode(wmsSiteCode)
    setBackendBase(backendBase)
    setSavedHint("Сохранено")
    window.setTimeout(() => setSavedHint(null), 1500)
  }

  async function loadIntegrations() {
    if (!isAdmin) return
    setIntegrationsLoading(true)
    setIntegrationsError(null)
    try {
      const qp = new URLSearchParams({ siteCode: wmsSiteCode || "DEFAULT" })
      const res = await fetch(`/api/app/integrations?${qp.toString()}`, {
        cache: "no-store",
        headers: authRequestHeaders(),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setIntegrationSettings({
        updateServer: data.updateServer || integrationSettings.updateServer,
        oneC: data.oneC || integrationSettings.oneC,
        crpt: data.crpt || integrationSettings.crpt,
        qpass: data.qpass || integrationSettings.qpass,
        database: data.database || integrationSettings.database,
      })
    } catch (e) {
      setIntegrationsError(e instanceof Error ? e.message : "Не удалось загрузить интеграции")
    } finally {
      setIntegrationsLoading(false)
    }
  }

  async function saveIntegrations() {
    setIntegrationsSaving(true)
    setIntegrationsError(null)
    setIntegrationsSaved(null)
    try {
      const res = await fetch("/api/app/integrations", {
        method: "PUT",
        headers: authRequestHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          siteCode: wmsSiteCode || "DEFAULT",
          updateServer: integrationSettings.updateServer,
          oneC: integrationSettings.oneC,
          qpass: integrationSettings.qpass,
          database: integrationSettings.database,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setIntegrationsSaved("Сохранено")
      window.setTimeout(() => setIntegrationsSaved(null), 1500)
      await loadIntegrations()
    } catch (e) {
      setIntegrationsError(e instanceof Error ? e.message : "Не удалось сохранить интеграции")
    } finally {
      setIntegrationsSaving(false)
    }
  }

  async function testDatabase() {
    setDbTesting(true)
    setIntegrationsError(null)
    setDbTestResult(null)
    try {
      const res = await fetch("/api/app/integrations/database-test", {
        method: "POST",
        headers: authRequestHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(integrationSettings.database),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`)
      setDbTestResult(`${data.message} (${data.elapsedMs} мс)`)
    } catch (e) {
      setIntegrationsError(e instanceof Error ? e.message : "Тест базы не выполнен")
    } finally {
      setDbTesting(false)
    }
  }

  async function testOneC() {
    setIntegrationsTesting(true)
    setIntegrationsError(null)
    setOneCTestResult(null)
    try {
      const res = await fetch("/api/app/integrations/one-c-test", {
        method: "POST",
        headers: authRequestHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ siteCode: wmsSiteCode || "DEFAULT", ...integrationSettings.oneC }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setOneCTestResult(
        data.ok
          ? `OData отвечает: ${data.total ?? "?"} позиций в Catalog_Номенклатура, ${data.elapsedMs} мс`
          : `Нет ответа: ${data.error || (data.status ? `HTTP ${data.status}` : "ошибка")}`
      )
    } catch (e) {
      setIntegrationsError(e instanceof Error ? e.message : "Тест 1С ERP не выполнен")
    } finally {
      setIntegrationsTesting(false)
    }
  }

  async function checkAppUpdate() {
    setUpdateChecking(true)
    setUpdateError(null)
    setUpdateStatus(null)
    try {
      const res = await fetch("/api/app/update-check", {
        cache: "no-store",
        headers: authRequestHeaders(),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setUpdateInfo(data)
      if (data.remoteError) {
        setUpdateStatus(`Сервер обновлений ответил с ошибкой: ${data.remoteError}`)
      } else if (data.updateAvailable && data.release) {
        setUpdateStatus(`Доступна сборка ${data.release.buildId}`)
      } else {
        setUpdateStatus("Обновлений нет")
      }
    } catch (e) {
      setUpdateError(e instanceof Error ? e.message : "Не удалось проверить обновления")
    } finally {
      setUpdateChecking(false)
    }
  }

  async function waitAppUpdateInstalled(targetBuildId: string) {
    const deadline = Date.now() + 10 * 60 * 1000
    while (Date.now() < deadline) {
      const res = await fetch(
        `/api/app/update-status?targetBuildId=${encodeURIComponent(targetBuildId)}`,
        { cache: "no-store", headers: authRequestHeaders() }
      )
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        if (data.job?.message) setUpdateStatus(data.job.message)
        if (data.installed || data.ready) return
        if (data.job?.status === "failed") {
          throw new Error(data.job.message || "Обновление завершилось с ошибкой")
        }
      }
      await new Promise((resolve) => window.setTimeout(resolve, 2000))
    }
    throw new Error("Превышено время ожидания обновления")
  }

  async function applyAppUpdate() {
    const release = updateInfo?.release
    if (!release?.buildId) {
      setUpdateError("Сначала проверьте обновления")
      return
    }
    setUpdateApplying(true)
    setUpdateError(null)
    setUpdateStatus("Запуск обновления...")
    try {
      const res = await fetch("/api/app/apply-update", {
        method: "POST",
        headers: authRequestHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ release }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setUpdateStatus("Установка обновления...")
      await waitAppUpdateInstalled(release.buildId)
      setUpdateStatus("Обновление установлено, перезагрузка...")
      window.location.reload()
    } catch (e) {
      setUpdateError(e instanceof Error ? e.message : "Не удалось установить обновление")
      setUpdateApplying(false)
    }
  }

  useEffect(() => {
    if (typeof window === "undefined") return
    const q = new URLSearchParams(window.location.search)
    const section = q.get("section")
    const dirTab = q.get("dirTab")
    if (section === "directories") setActiveSection("directories")
    if (section === "updates") setActiveSection("updates")
    if (section === "integrations") setActiveSection("integrations")
    if (section === "documents") setActiveSection("documents")
    if (section === "appearance") setActiveSection("appearance")
    if (
      dirTab === "warehouses" ||
      dirTab === "workshops" ||
      dirTab === "productionLines" ||
      dirTab === "users" ||
      dirTab === "recipients" ||
      dirTab === "suppliers" ||
      dirTab === "itemGroups" ||
      dirTab === "itemClasses" ||
      dirTab === "receivingCategories" ||
      dirTab === "packagingNom" ||
      dirTab === "cellProfile"
    ) {
      setActiveSection("directories")
      setDirectoryTab(dirTab)
    }
  }, [])

  useEffect(() => {
    let ignore = false
    async function loadProfile() {
      setProfileLoading(true)
      setProfileError(null)
      try {
        const meRes = await fetch("/api/auth/me", {
          cache: "no-store",
          headers: authRequestHeaders(),
        })
        const meData = meRes.ok
          ? ((await meRes.json()) as { user?: { userId?: string | null; roleCodes?: string[] | null } })
          : { user: null }
        const sessionUserId = meData.user?.userId ?? null
        const rolesFromSession = Array.isArray(meData.user?.roleCodes) ? meData.user.roleCodes : []
        const [notif, userList] = await Promise.all([
          listNotifications(sessionUserId ? { userId: sessionUserId } : undefined),
          listUsers(),
        ])
        if (ignore) return
        setSessionRoleCodes(rolesFromSession)
        setCurrentUserId(sessionUserId || notif.currentUserId)
        setUsers(userList.users || [])
        setInAppNotifications(notif.notifications || [])
        setUnreadCount(notif.unreadCount || 0)
      } catch (e) {
        if (ignore) return
        setProfileError(e instanceof Error ? e.message : "Не удалось загрузить профиль")
      } finally {
        if (!ignore) setProfileLoading(false)
      }
    }

    async function loadOrg() {
      setOrgLoading(true)
      setOrgError(null)
      try {
        const occ = await getWarehouseOccupancy()
        if (ignore) return
        setOrgSummary({
          siteCode: occ.siteCode,
          zones: occ.zones?.length || 0,
          locationCount: occ.totals.locationCount,
          nonEmptyCount: occ.totals.nonEmptyCount,
          emptyCount: occ.totals.emptyCount,
          totalAvailableQty: occ.totals.totalAvailableQty,
        })
      } catch (e) {
        if (ignore) return
        setOrgError(e instanceof Error ? e.message : "Не удалось загрузить данные склада")
      } finally {
        if (!ignore) setOrgLoading(false)
      }
    }

    void loadProfile()
    void loadOrg()
    return () => {
      ignore = true
    }
  }, [])

  useEffect(() => {
    if (activeSection === "integrations" && !isAdmin) {
      setActiveSection("profile")
    }
    if (activeSection === "integrations" && isAdmin) {
      void loadIntegrations()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection, isAdmin])

  async function refreshNotifications() {
    setNotifLoading(true)
    setNotifError(null)
    try {
      const notif = await listNotifications(currentUserId ? { userId: currentUserId } : undefined)
      setCurrentUserId(notif.currentUserId)
      setInAppNotifications(notif.notifications || [])
      setUnreadCount(notif.unreadCount || 0)
    } catch (e) {
      setNotifError(e instanceof Error ? e.message : "Не удалось загрузить уведомления")
    } finally {
      setNotifLoading(false)
    }
  }

  async function markRead(notification: WmsNotificationRow) {
    if (!currentUserId || notification.readAt) return
    await markNotificationRead({ notificationId: notification.notificationId, userId: currentUserId }).catch(
      () => undefined
    )
    await refreshNotifications()
  }

  const currentUser = useMemo(() => {
    if (!currentUserId) return null
    return users.find((u) => u.userId === currentUserId) || null
  }, [currentUserId, users])

  function toggleCreateUserRole(code: string) {
    setCreateUserForm((prev) => {
      const has = prev.roleCodes.includes(code)
      const next = has ? prev.roleCodes.filter((c) => c !== code) : [...prev.roleCodes, code]
      return { ...prev, roleCodes: next.length ? next : ["warehouse_operator"] }
    })
  }

  async function submitCreateUser() {
    if (!createUserForm.login.trim()) {
      setCreateUserError("Укажите login")
      return
    }
    if (!createUserForm.displayName.trim()) {
      setCreateUserError("Укажите отображаемое имя")
      return
    }
    if (!createUserForm.password.trim() || createUserForm.password.trim().length < 4) {
      setCreateUserError("Укажите пароль (минимум 4 символа)")
      return
    }
    setCreateUserLoading(true)
    setCreateUserError(null)
    try {
      await createWmsUser({
        login: createUserForm.login.trim(),
        displayName: createUserForm.displayName.trim(),
        password: createUserForm.password,
        position: createUserForm.position.trim() || null,
        phone: createUserForm.phone.trim() || null,
        externalCode: createUserForm.externalCode.trim() || null,
        roleCodes: createUserForm.roleCodes,
      })
      setCreateUserOpen(false)
      setCreateUserForm({
        login: "",
        displayName: "",
        password: "",
        position: "",
        phone: "",
        externalCode: "",
        roleCodes: ["warehouse_operator"],
      })
      await reloadUsersOnly()
    } catch (e) {
      setCreateUserError(e instanceof Error ? e.message : "Не удалось создать пользователя")
    } finally {
      setCreateUserLoading(false)
    }
  }

  function openPasswordDialog(user: WmsUserRow) {
    setPasswordUser(user)
    setPasswordValue("")
    setPasswordError(null)
  }

  async function submitPasswordChange() {
    if (!passwordUser) return
    const password = passwordValue.trim()
    if (password.length < 4) {
      setPasswordError("Пароль должен быть минимум 4 символа")
      return
    }
    setPasswordLoading(true)
    setPasswordError(null)
    try {
      await updateWmsUser({ userId: passwordUser.userId, password })
      setPasswordUser(null)
      setPasswordValue("")
      await reloadUsersOnly()
    } catch (e) {
      setPasswordError(e instanceof Error ? e.message : "Не удалось сменить пароль")
    } finally {
      setPasswordLoading(false)
    }
  }

  async function deleteUser(user: WmsUserRow) {
    if (user.userId === currentUserId) {
      setProfileError("Нельзя удалить текущего пользователя, под которым вы вошли")
      return
    }
    const ok = window.confirm(`Удалить пользователя "${user.displayName}" (${user.login})?`)
    if (!ok) return
    setDeletingUserId(user.userId)
    setProfileError(null)
    try {
      await deleteWmsUser(user.userId)
      await reloadUsersOnly()
    } catch (e) {
      setProfileError(e instanceof Error ? e.message : "Не удалось удалить пользователя")
    } finally {
      setDeletingUserId(null)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden p-4 sm:p-6">
      <div className="mb-4 shrink-0">
        <h1 className="text-2xl font-bold text-foreground">Настройки</h1>
        <p className="text-sm text-muted-foreground">Конфигурация системы и пользователя</p>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="min-h-0 overflow-y-auto lg:overscroll-contain">
          <div className="rounded-2xl bg-card p-2 shadow-sm">
            {visibleSettingsSections.map((section) => (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl p-3 text-left transition-all",
                  activeSection === section.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                )}
              >
                <section.icon className="h-5 w-5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{section.title}</div>
                  {activeSection === section.id ? (
                    <div className="mt-0.5 text-[11px] leading-snug opacity-80">{section.description}</div>
                  ) : null}
                </div>
              </button>
            ))}
          </div>
        </aside>

        <div
          className={cn(
            "flex min-h-0 min-w-0 flex-col",
            activeSection === "directories" ? "overflow-hidden" : "overflow-y-auto overscroll-contain"
          )}
        >
          {activeSection === "profile" && (
            <div className="rounded-2xl bg-card p-6 shadow-sm">
              <h2 className="mb-6 text-lg font-semibold text-foreground">Профиль пользователя</h2>
              
              <div className="mb-6 flex items-center gap-4">
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <User className="h-10 w-10" />
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">WMS user</div>
                  <div className="text-sm font-medium text-foreground">{currentUser?.displayName || "—"}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {currentUserId ? `userId: ${currentUserId}` : "userId: —"}
                  </div>
                </div>
              </div>

              {profileError ? (
                <WmsErrorState
                  className="mb-4"
                  title="Не удалось загрузить профиль"
                  message={profileError}
                  onRetry={() => void loadProfile()}
                />
              ) : null}

              {profileLoading ? (
                <WmsTableSkeleton rows={4} columns={2} />
              ) : currentUser ? (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">Login</label>
                    <Input value={currentUser.login} readOnly className="rounded-xl" />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">Display name</label>
                    <Input value={currentUser.displayName} readOnly className="rounded-xl" />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">External code</label>
                    <Input value={currentUser.externalCode || "—"} readOnly className="rounded-xl" />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">Телефон</label>
                    <Input value={currentUser.phone || "—"} readOnly className="rounded-xl" />
                  </div>
                  <div className="col-span-2">
                    <label className="mb-2 block text-sm font-medium text-foreground">Роли</label>
                    <div className="flex flex-wrap gap-2">
                      {(currentUser.roles || []).length === 0 ? (
                        <span className="text-sm text-muted-foreground">—</span>
                      ) : (
                        currentUser.roles.map((r) => (
                          <Badge key={r} variant="secondary" className="rounded-lg">
                            {r}
                          </Badge>
                        ))
                      )}
                    </div>
                  </div>
                  <div className="col-span-2">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="text-sm text-muted-foreground">
                        Статус:{" "}
                        <span className={currentUser.isActive ? "text-success" : "text-destructive"}>
                          {currentUser.isActive ? "активен" : "неактивен"}
                        </span>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="rounded-xl"
                        onClick={() => openPasswordDialog(currentUser)}
                      >
                        <KeyRound className="mr-2 h-4 w-4" />
                        Сменить пароль
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">Пользователь не найден для текущей площадки</div>
              )}

              <SettingsApiTokensPanel />

              <div className="mt-8 border-t border-border pt-6">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-foreground">Пользователи площадки</h3>
                    <p className="text-sm text-muted-foreground">
                      Один пользователь для входа на сайт и для назначения на ТСД. ID из колонки ниже используйте в терминалах.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-xl shrink-0"
                    onClick={() => {
                      setCreateUserError(null)
                      setCreateUserOpen(true)
                    }}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Добавить
                  </Button>
                </div>
                {users.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Нет пользователей в списке.</p>
                ) : (
                  <div className="divide-y divide-border rounded-xl border border-border">
                    {users.map((u) => (
                      <div key={u.userId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                        <div>
                          <span className="font-medium text-foreground">{u.displayName}</span>
                          <span className="text-muted-foreground"> · {u.login}</span>
                          <span className="mt-0.5 block font-mono text-xs text-muted-foreground">ID {u.userId}</span>
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-1">
                          <div className="flex flex-wrap items-center gap-1">
                            {u.hasPassword === false ? (
                              <Badge variant="outline" className="rounded-md text-xs text-chart-3">
                                без пароля
                              </Badge>
                            ) : null}
                            {(u.roles || []).map((r) => (
                              <Badge key={r} variant="secondary" className="rounded-md text-xs">
                                {r}
                              </Badge>
                            ))}
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 rounded-lg px-2"
                            onClick={() => openPasswordDialog(u)}
                          >
                            <KeyRound className="h-4 w-4" />
                            <span className="sr-only">Сменить пароль</span>
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 rounded-lg px-2 text-destructive hover:text-destructive"
                            disabled={deletingUserId === u.userId || u.userId === currentUserId}
                            onClick={() => void deleteUser(u)}
                            title={u.userId === currentUserId ? "Нельзя удалить текущего пользователя" : "Удалить"}
                          >
                            <Trash2 className="h-4 w-4" />
                            <span className="sr-only">Удалить</span>
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeSection === "notifications" && (
            <div className="rounded-2xl bg-card p-6 shadow-sm">
              <h2 className="mb-6 text-lg font-semibold text-foreground">Уведомления</h2>

              <div className="mb-6">
                <ExpiryProductMailSettings />
              </div>
              
              <div className="mb-6 rounded-xl border border-border p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <div className="font-medium text-foreground">In-app уведомления</div>
                    <div className="text-sm text-muted-foreground">
                      Непрочитанных: <span className="font-medium text-foreground">{unreadCount}</span>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-xl"
                    onClick={() => void refreshNotifications()}
                    disabled={notifLoading}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Обновить
                  </Button>
                </div>

                {notifError ? (
                  <WmsErrorState
                    className="mb-3"
                    title="Не удалось загрузить уведомления"
                    message={notifError}
                    onRetry={() => void refreshNotifications()}
                  />
                ) : null}

                {notifLoading ? (
                  <WmsTableSkeleton rows={5} columns={1} />
                ) : inAppNotifications.length === 0 ? (
                  <div className="text-sm text-muted-foreground">Нет уведомлений</div>
                ) : (
                  <div className="divide-y divide-border rounded-lg border border-border">
                    {inAppNotifications.slice(0, 12).map((n) => (
                      <button
                        key={n.notificationId}
                        className={cn(
                          "w-full text-left p-3 text-sm hover:bg-secondary/50",
                          !n.readAt && "bg-primary/5"
                        )}
                        onClick={() => void markRead(n)}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-medium text-foreground">{n.title}</div>
                          {!n.readAt && (
                            <Badge variant="secondary" className="rounded-lg bg-destructive/10 text-destructive">
                              новое
                            </Badge>
                          )}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">{n.body}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {new Date(n.createdAt).toLocaleString("ru-RU")}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between rounded-xl bg-secondary p-4">
                  <div>
                    <div className="font-medium text-foreground">Email уведомления</div>
                    <div className="text-sm text-muted-foreground">Получать важные оповещения на почту</div>
                  </div>
                  <Switch 
                    checked={notifications.email} 
                    onCheckedChange={(v) => setNotifications(prev => ({ ...prev, email: v }))} 
                  />
                </div>
                <div className="flex items-center justify-between rounded-xl bg-secondary p-4">
                  <div>
                    <div className="font-medium text-foreground">Push уведомления</div>
                    <div className="text-sm text-muted-foreground">Уведомления в браузере</div>
                  </div>
                  <Switch 
                    checked={notifications.push} 
                    onCheckedChange={(v) => setNotifications(prev => ({ ...prev, push: v }))} 
                  />
                </div>
                <div className="flex items-center justify-between rounded-xl bg-secondary p-4">
                  <div>
                    <div className="font-medium text-foreground">Новые задачи</div>
                    <div className="text-sm text-muted-foreground">Уведомлять о назначенных задачах</div>
                  </div>
                  <Switch 
                    checked={notifications.tasks} 
                    onCheckedChange={(v) => setNotifications(prev => ({ ...prev, tasks: v }))} 
                  />
                </div>
                <div className="flex items-center justify-between rounded-xl bg-secondary p-4">
                  <div>
                    <div className="font-medium text-foreground">Отчёты</div>
                    <div className="text-sm text-muted-foreground">Ежедневные сводки по email</div>
                  </div>
                  <Switch 
                    checked={notifications.reports} 
                    onCheckedChange={(v) => setNotifications(prev => ({ ...prev, reports: v }))} 
                  />
                </div>
              </div>

              <div className="mt-4 rounded-xl bg-secondary p-4 text-sm text-muted-foreground">
                Переключатели ниже — UI-настройки и пока не сохраняются в WMS (write API для предпочтений ещё не добавлен).
              </div>
            </div>
          )}

          {activeSection === "company" && (
            <div className="rounded-2xl bg-card p-6 shadow-sm">
              <h2 className="mb-6 text-lg font-semibold text-foreground">Данные организации</h2>
              
              {orgError ? (
                <WmsErrorState
                  className="mb-4"
                  title="Не удалось загрузить сводку склада"
                  message={orgError}
                  onRetry={() => void loadOrgSummary()}
                />
              ) : null}

              {orgLoading ? (
                <WmsLoadingState label="Загрузка данных склада…" className="border-none bg-transparent shadow-none" />
              ) : orgSummary ? (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">siteCode</label>
                    <Input value={orgSummary.siteCode} readOnly className="rounded-xl" />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">Зон</label>
                    <Input value={String(orgSummary.zones)} readOnly className="rounded-xl" />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">Ячеек всего</label>
                    <Input value={String(orgSummary.locationCount)} readOnly className="rounded-xl" />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">Ячеек занято</label>
                    <Input value={String(orgSummary.nonEmptyCount)} readOnly className="rounded-xl" />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">Ячеек свободно</label>
                    <Input value={String(orgSummary.emptyCount)} readOnly className="rounded-xl" />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">Остаток (шт.)</label>
                    <Input value={String(orgSummary.totalAvailableQty)} readOnly className="rounded-xl" />
                  </div>
                  <div className="col-span-2 text-sm text-muted-foreground">
                    Примечание: редактируемых реквизитов организации (ИНН/адрес) в текущем WMS API нет — показана фактическая сводка склада.
                  </div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">Нет данных</div>
              )}
            </div>
          )}

          {activeSection === "directories" && (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-card p-6 shadow-sm">
              <div className="shrink-0">
              <h2 className="mb-1 text-lg font-semibold text-foreground">Справочники</h2>
              <p className="mb-6 text-sm text-muted-foreground">
                Склады, группы товаров, подгруппы приёмки и правила отгрузки. Навигация слева остаётся на месте —
                листается только этот блок.
              </p>
              </div>
              <div className="grid min-h-0 flex-1 gap-6 overflow-hidden lg:grid-cols-[220px_minmax(0,1fr)]">
                <nav className="space-y-5 overflow-y-auto overscroll-contain rounded-xl border border-border/60 bg-secondary/20 p-3">
                  {directoryTabGroups.map((group) => (
                    <div key={group.title}>
                      <div className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {group.title}
                      </div>
                      <ul className="space-y-0.5">
                        {group.tabs.map((tab) => (
                          <li key={tab.id}>
                            <button
                              type="button"
                              onClick={() => selectDirectoryTab(tab.id)}
                              className={cn(
                                "w-full rounded-lg px-2 py-2 text-left transition-colors",
                                directoryTab === tab.id
                                  ? "bg-primary text-primary-foreground shadow-sm"
                                  : "text-foreground hover:bg-secondary"
                              )}
                            >
                              <div className="text-sm font-medium leading-snug">{tab.title}</div>
                              <div
                                className={cn(
                                  "mt-0.5 text-[10px] leading-snug",
                                  directoryTab === tab.id ? "text-primary-foreground/80" : "text-muted-foreground"
                                )}
                              >
                                {tab.hint}
                              </div>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </nav>
                <div className="min-h-0 min-w-0 overflow-y-auto overscroll-contain">
                  {directoryTab === "warehouses" ? (
                    <SettingsDirectoriesWarehouses />
                  ) : directoryTab === "zones" ? (
                    <SettingsDirectoriesZones />
                  ) : directoryTab === "workshops" ? (
                    <SettingsDirectoriesWorkshops />
                  ) : directoryTab === "productionLines" ? (
                    <SettingsDirectoriesProductionLines />
                  ) : directoryTab === "users" ? (
                    <SettingsDirectoriesUsers
                      users={users}
                      loading={profileLoading}
                      error={profileError}
                      onRefresh={reloadUsersOnly}
                      onAddUser={() => {
                        setCreateUserError(null)
                        setCreateUserOpen(true)
                      }}
                      onChangePassword={openPasswordDialog}
                      onDeleteUser={(user) => void deleteUser(user)}
                      currentUserId={currentUserId}
                      deletingUserId={deletingUserId}
                    />
                  ) : directoryTab === "recipients" ? (
                    <SettingsDirectoriesIssueRecipients />
                  ) : directoryTab === "suppliers" ? (
                    <SettingsDirectoriesSuppliers />
                  ) : directoryTab === "racks" ? (
                    <SettingsDirectoriesRacks />
                  ) : directoryTab === "itemGroups" ? (
                    <SettingsDirectoriesItemGroupsUom />
                  ) : directoryTab === "itemClasses" ? (
                    <SettingsDirectoriesItemClasses />
                  ) : directoryTab === "receivingCategories" ? (
                    <SettingsDirectoriesReceivingCategories />
                  ) : directoryTab === "writeoffReasons" ? (
                    <SettingsDirectoriesWriteoffReasons />
                  ) : directoryTab === "shipRules" ? (
                    <SettingsDirectoriesShipRules />
                  ) : directoryTab === "packagingNom" ? (
                    <SettingsDirectoriesPackagingNom />
                  ) : (
                    <SettingsDirectoriesCellProfile />
                  )}
                </div>
              </div>
            </div>
          )}

          {activeSection === "integrations" && isAdmin && (
            <div className="rounded-2xl bg-card p-6 shadow-sm">
              <h2 className="mb-2 text-lg font-semibold text-foreground">Интеграции</h2>
              <p className="mb-6 text-sm text-muted-foreground">
                Адреса внешних систем и служебные токены. Раздел доступен только роли admin.
              </p>

              {integrationsError ? (
                <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                  {integrationsError}
                </div>
              ) : null}
              {integrationsSaved ? <div className="mb-4 text-sm text-success">{integrationsSaved}</div> : null}


              <div className="mb-6 rounded-xl border border-border bg-secondary/20 p-4">
                <div className="mb-4">
                  <div className="font-medium text-foreground">База данных</div>
                </div>
                {integrationSettings.database.live?.ok ? (
                  <div className="mb-4 rounded-xl bg-secondary p-3 text-sm">
                    Сейчас отвечает: <span className="font-mono">{integrationSettings.database.live.database}</span>
                    {" @ "}
                    <span className="font-mono">{integrationSettings.database.live.address}:{integrationSettings.database.live.port}</span>
                    {" · PostgreSQL "}
                    {integrationSettings.database.live.version}
                  </div>
                ) : integrationSettings.database.live ? (
                  <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                    {integrationSettings.database.live.message}
                  </div>
                ) : null}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">Хост</label>
                    <Input
                      value={integrationSettings.database.remoteHost}
                      onChange={(e) =>
                        setIntegrationSettings((p) => ({
                          ...p,
                          database: { ...p.database, remoteHost: e.target.value, host: e.target.value },
                        }))
                      }
                      className="rounded-xl font-mono text-xs"
                      placeholder="127.0.0.1"
                    />

                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">Порт</label>
                    <Input
                      value={integrationSettings.database.remotePort}
                      onChange={(e) =>
                        setIntegrationSettings((p) => ({
                          ...p,
                          database: { ...p.database, remotePort: e.target.value, port: e.target.value },
                        }))
                      }
                      className="rounded-xl font-mono text-xs"
                      placeholder="5432"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">База</label>
                    <Input
                      value={integrationSettings.database.database}
                      onChange={(e) =>
                        setIntegrationSettings((p) => ({
                          ...p,
                          database: { ...p.database, database: e.target.value },
                        }))
                      }
                      className="rounded-xl font-mono text-xs"
                      placeholder="wms_edge"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">Пользователь</label>
                    <Input
                      value={integrationSettings.database.user}
                      onChange={(e) =>
                        setIntegrationSettings((p) => ({
                          ...p,
                          database: { ...p.database, user: e.target.value },
                        }))
                      }
                      className="rounded-xl font-mono text-xs"
                      placeholder="postgres"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">Пароль</label>
                    <Input
                      type="password"
                      value={integrationSettings.database.password}
                      onChange={(e) =>
                        setIntegrationSettings((p) => ({
                          ...p,
                          database: { ...p.database, password: e.target.value },
                        }))
                      }
                      className="rounded-xl font-mono text-xs"
                      autoComplete="new-password"
                      placeholder={integrationSettings.database.passwordConfigured ? "пароль задан" : "пароль не задан"}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      Пустое поле при сохранении не затирает текущий пароль.
                    </p>
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">SSL</label>
                    <select
                      value={integrationSettings.database.sslmode}
                      onChange={(e) =>
                        setIntegrationSettings((p) => ({
                          ...p,
                          database: {
                            ...p.database,
                            sslmode: e.target.value as "disable" | "require" | "prefer",
                          },
                        }))
                      }
                      className="flex h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="disable">disable — внутри туннеля</option>
                      <option value="prefer">prefer</option>
                      <option value="require">require</option>
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="mb-2 block text-sm font-medium text-foreground">Строка подключения</label>
                    <Input
                      value={integrationSettings.database.urlPreview || `${integrationSettings.database.appHost}:${integrationSettings.database.appPort}`}
                      readOnly
                      className="rounded-xl font-mono text-xs"
                    />

                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm text-muted-foreground">{dbTestResult || "Проверка подключения."}</div>
                  <Button variant="outline" className="rounded-xl" onClick={() => void testDatabase()} disabled={dbTesting}>
                    <RefreshCw className={cn("mr-2 h-4 w-4", dbTesting && "animate-spin")} />
                    Тест
                  </Button>
                </div>
              </div>

              <div className="mb-6 rounded-xl border border-border bg-secondary/20 p-4">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <div className="font-medium text-foreground">WMS</div>
                    <div className="text-sm text-muted-foreground">Площадка и адрес backend (опционально)</div>
                  </div>
                  {savedHint && <span className="text-sm text-success">{savedHint}</span>}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-1">
                    <label className="mb-2 block text-sm font-medium text-foreground">siteCode</label>
                    <Input
                      value={wmsSiteCode}
                      onChange={(e) => setWmsSiteCode(e.target.value)}
                      placeholder="DEFAULT"
                      className="rounded-xl"
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      Используется во всех `/api/wms/*` запросах интерфейса.
                    </p>
                  </div>
                  <div className="col-span-1">
                    <label className="mb-2 block text-sm font-medium text-foreground">backend base URL (опционально)</label>
                    <Input
                      value={backendBase}
                      onChange={(e) => setBackendBaseValue(e.target.value)}
                      placeholder="http://localhost:3000"
                      className="rounded-xl"
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      Используется для открытия backend-страниц (например, 3D viewer/editor).
                    </p>
                  </div>
                </div>

                <div className="mt-4 flex justify-end">
                  <Button className="rounded-xl bg-primary text-primary-foreground" onClick={saveWmsSettings}>
                    <Save className="mr-2 h-4 w-4" />
                    Сохранить
                  </Button>
                </div>
              </div>

              <div className="mb-6 rounded-xl border border-border bg-secondary/20 p-4">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium text-foreground">Сервер обновлений</div>
                    <div className="text-sm text-muted-foreground">Проверка и установка только здесь — окно больше не всплывает поверх всех страниц.</div>
                  </div>
                  <Button variant="outline" className="rounded-xl" onClick={() => void loadIntegrations()} disabled={integrationsLoading}>
                    <RefreshCw className={cn("mr-2 h-4 w-4", integrationsLoading && "animate-spin")} />
                    Обновить
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">Адрес сервера обновлений</label>
                    <Input
                      value={integrationSettings.updateServer.url}
                      onChange={(e) =>
                        setIntegrationSettings((p) => ({
                          ...p,
                          updateServer: { ...p.updateServer, url: e.target.value },
                        }))
                      }
                      className="rounded-xl"
                      placeholder="https://scada25.ru"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">Токен подключения</label>
                    <Input
                      type="password"
                      value={integrationSettings.updateServer.token}
                      onChange={(e) =>
                        setIntegrationSettings((p) => ({
                          ...p,
                          updateServer: { ...p.updateServer, token: e.target.value },
                        }))
                      }
                      className="rounded-xl font-mono text-xs"
                      placeholder={integrationSettings.updateServer.tokenConfigured ? "токен задан" : "токен не задан"}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      Статус: {integrationSettings.updateServer.tokenConfigured ? "токен сохранён" : "токен не задан"}.
                    </p>
                  </div>
                  <div className="col-span-2 flex items-center justify-between rounded-xl bg-secondary p-3">
                    <div>
                      <div className="text-sm font-medium">Разрешить небезопасный TLS</div>
                      <div className="text-xs text-muted-foreground">Нужно только для тестовых сертификатов.</div>
                    </div>
                    <Switch
                      checked={integrationSettings.updateServer.insecureTls}
                      onCheckedChange={(insecureTls) =>
                        setIntegrationSettings((p) => ({
                          ...p,
                          updateServer: { ...p.updateServer, insecureTls },
                        }))
                      }
                    />
                  </div>
                </div>
              </div>

              <div className="mb-6 rounded-xl border border-border bg-secondary/20 p-4">
                <div className="mb-4 flex items-center justify-between">
                  <div className="font-medium text-foreground">1С ERP</div>
                  <Switch
                    checked={integrationSettings.oneC.enabled}
                    onCheckedChange={(enabled) =>
                      setIntegrationSettings((p) => ({ ...p, oneC: { ...p.oneC, enabled } }))
                    }
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="mb-2 block text-sm font-medium text-foreground">Адрес OData</label>
                    <Input
                      value={integrationSettings.oneC.baseUrl}
                      onChange={(e) =>
                        setIntegrationSettings((p) => ({ ...p, oneC: { ...p.oneC, baseUrl: e.target.value } }))
                      }
                      className="rounded-xl font-mono text-xs"
                      placeholder="http://host/ERP_BASE/odata/standard.odata"
                    />
                  </div>
                  <div className="col-span-2 flex items-center justify-between rounded-xl bg-secondary p-3">
                    <div className="text-sm font-medium">Через завод 10.26</div>
                    <Switch
                      checked={integrationSettings.oneC.viaFactory !== false}
                      onCheckedChange={(viaFactory) =>
                        setIntegrationSettings((p) => ({ ...p, oneC: { ...p.oneC, viaFactory } }))
                      }
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">Логин</label>
                    <Input
                      value={integrationSettings.oneC.login}
                      onChange={(e) =>
                        setIntegrationSettings((p) => ({ ...p, oneC: { ...p.oneC, login: e.target.value } }))
                      }
                      className="rounded-xl"
                      autoComplete="off"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">Пароль</label>
                    <Input
                      type="password"
                      value={integrationSettings.oneC.password}
                      onChange={(e) =>
                        setIntegrationSettings((p) => ({ ...p, oneC: { ...p.oneC, password: e.target.value } }))
                      }
                      className="rounded-xl"
                      autoComplete="new-password"
                      placeholder={integrationSettings.oneC.passwordConfigured ? "сохранён" : ""}
                    />
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm text-muted-foreground">{oneCTestResult}</div>
                  <Button variant="outline" className="rounded-xl" onClick={() => void testOneC()} disabled={integrationsTesting}>
                    <RefreshCw className={cn("mr-2 h-4 w-4", integrationsTesting && "animate-spin")} />
                    Тест
                  </Button>
                </div>
                <OneCTransferSyncPanel />
              </div>

              <div className="mb-6 rounded-xl border border-border bg-secondary/20 p-4">
                <div className="mb-4">
                  <div className="font-medium text-foreground">QPass</div>
                  <div className="text-sm text-muted-foreground">
                    Паспорта оборудования. Токен выдают в Scada ID → Админ → Токены (приложение QPass)
                    или в QPass → Настройки.
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">Адрес QPass</label>
                    <Input
                      value={integrationSettings.qpass.origin}
                      onChange={(e) =>
                        setIntegrationSettings((p) => ({
                          ...p,
                          qpass: { ...p.qpass, origin: e.target.value },
                        }))
                      }
                      className="rounded-xl"
                      placeholder="https://qpass.scada25.ru"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">API-токен</label>
                    <Input
                      type="password"
                      value={integrationSettings.qpass.token}
                      onChange={(e) =>
                        setIntegrationSettings((p) => ({
                          ...p,
                          qpass: { ...p.qpass, token: e.target.value },
                        }))
                      }
                      className="rounded-xl font-mono text-xs"
                      placeholder={integrationSettings.qpass.tokenConfigured ? "токен задан" : "токен не задан"}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      Статус: {integrationSettings.qpass.tokenConfigured ? "токен сохранён" : "токен не задан"}.
                    </p>
                  </div>
                  <div className="col-span-2">
                    <label className="mb-2 block text-sm font-medium text-foreground">Ensure URL (опционально)</label>
                    <Input
                      value={integrationSettings.qpass.ensureUrl}
                      onChange={(e) =>
                        setIntegrationSettings((p) => ({
                          ...p,
                          qpass: { ...p.qpass, ensureUrl: e.target.value },
                        }))
                      }
                      className="rounded-xl font-mono text-xs"
                      placeholder="https://qpass.scada25.ru/api/v1/equipment/ensure"
                    />
                  </div>
                </div>
                <div className="mt-3 text-xs text-muted-foreground">
                  <a className="text-primary underline-offset-2 hover:underline" href="https://id.scada25.ru/admin" target="_blank" rel="noreferrer">
                    Выдать токен в Scada ID
                  </a>
                  {" · "}
                  <a className="text-primary underline-offset-2 hover:underline" href="https://qpass.scada25.ru/settings" target="_blank" rel="noreferrer">
                    Настройки QPass
                  </a>
                </div>
              </div>

              <div className="mb-6 rounded-xl border border-border bg-secondary/20 p-4">
                <div className="font-medium text-foreground">CRPT / Честный Знак</div>
                <div className="mt-1 text-sm text-muted-foreground">{integrationSettings.crpt.note}</div>
                <Badge variant={integrationSettings.crpt.configured ? "default" : "secondary"} className="mt-3 rounded-lg">
                  {integrationSettings.crpt.configured ? "токен найден в env" : "токен не найден в env"}
                </Badge>
              </div>

              <div className="flex justify-end">
                <Button
                  className="rounded-xl bg-primary text-primary-foreground"
                  onClick={() => void saveIntegrations()}
                  disabled={integrationsSaving}
                >
                  <Save className="mr-2 h-4 w-4" />
                  {integrationsSaving ? "Сохранение..." : "Сохранить интеграции"}
                </Button>
              </div>
            </div>
          )}

          {activeSection === "updates" && (
            <div className="rounded-2xl bg-card p-6 shadow-sm">
              <div className="mb-6 flex items-start justify-between gap-4">
                <div>
                  <h2 className="mb-2 text-lg font-semibold text-foreground">Обновления</h2>
                  <p className="text-sm text-muted-foreground">
                    Ручная проверка scada25.ru и установка последнего пакета на локальный интерфейс.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-xl"
                  onClick={() => void checkAppUpdate()}
                  disabled={updateChecking || updateApplying}
                >
                  <RefreshCw className={cn("mr-2 h-4 w-4", updateChecking && "animate-spin")} />
                  Проверить
                </Button>
              </div>

              <div className="space-y-4">
                <div className="rounded-xl border border-border bg-secondary/30 p-4 text-sm">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-muted-foreground">Локальная сборка</div>
                      <div className="font-mono text-xs text-foreground">
                        {updateInfo?.local?.buildId || "ещё не проверялась"}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Сервер обновлений</div>
                      <div className="text-foreground">
                        {updateInfo?.serverConfigured === false ? "не настроен" : "https://scada25.ru"}
                      </div>
                    </div>
                  </div>
                </div>

                {updateInfo?.tsd ? (
                  <div className="rounded-xl border border-border bg-secondary/20 p-4 text-sm">
                    <div className="mb-1 font-medium text-foreground">Приложение ТСД</div>
                    {updateInfo.tsd.error ? (
                      <div className="text-destructive">Сервер ТСД: {updateInfo.tsd.error}</div>
                    ) : updateInfo.tsd.release ? (
                      <div className="text-muted-foreground">
                        Каталог:{" "}
                        <span className="font-mono text-foreground">
                          {updateInfo.tsd.release.versionName} · {updateInfo.tsd.release.buildId}
                        </span>
                        {updateInfo.tsd.release.apkSha256 ? (
                          <span className="ml-2 font-mono text-[11px]">
                            sha256 {updateInfo.tsd.release.apkSha256.slice(0, 12)}…
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <div className="text-muted-foreground">В каталоге нет сборки ТСД.</div>
                    )}
                  </div>
                ) : null}

                {updateInfo?.release ? (
                  <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="font-medium text-foreground">
                          Версия {updateInfo.release.version}
                        </div>
                        <div className="font-mono text-xs text-muted-foreground">
                          {updateInfo.release.buildId}
                        </div>
                      </div>
                      <Badge variant={updateInfo.updateAvailable ? "default" : "secondary"} className="rounded-lg">
                        {updateInfo.updateAvailable ? "доступно" : "установлено"}
                      </Badge>
                    </div>
                    <div className="whitespace-pre-wrap text-sm text-muted-foreground">
                      {updateInfo.release.changelog}
                    </div>
                  </div>
                ) : null}

                {updateStatus ? (
                  <div className="rounded-xl bg-secondary p-3 text-sm text-muted-foreground">
                    {updateStatus}
                  </div>
                ) : null}
                {updateError ? (
                  <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                    {updateError}
                  </div>
                ) : null}

                <div className="flex justify-end">
                  <Button
                    type="button"
                    className="rounded-xl bg-primary text-primary-foreground"
                    onClick={() => void applyAppUpdate()}
                    disabled={!updateInfo?.updateAvailable || !updateInfo.release || updateApplying || updateChecking}
                  >
                    <RefreshCw className={cn("mr-2 h-4 w-4", updateApplying && "animate-spin")} />
                    {updateApplying ? "Установка..." : "Установить обновление"}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {activeSection === "appearance" && (
            <div className="space-y-6">
              <div className="rounded-2xl bg-card p-6 shadow-sm">
                <h2 className="mb-2 text-lg font-semibold text-foreground">Внешний вид</h2>
                <p className="mb-6 text-sm text-muted-foreground">
                  Оформление QR на этикетках склада. Тема интерфейса задаётся отдельно в шапке.
                </p>
                <SettingsQrVisual />
              </div>
              <div className="rounded-2xl bg-card p-6 shadow-sm">
                <h2 className="mb-2 text-lg font-semibold text-foreground">Шаблон этикетки ячейки</h2>
                <p className="mb-6 text-sm text-muted-foreground">
                  Размер наклейки, текст с переменными (имя, профиль, код). QR подставляется из блока выше.
                </p>
                <SettingsCellLabelTemplate />
              </div>
            </div>
          )}

          {activeSection === "security" && (
            <SettingsSecurityPanel isAdmin={isAdmin} />
          )}

          {activeSection === "documents" && (
            <div className="space-y-6">
              <div className="rounded-2xl bg-card p-6 shadow-sm">
                <SettingsTorg1Template />
              </div>
              <div className="rounded-2xl bg-card p-6 shadow-sm">
                <SettingsTorg16Template />
              </div>
            </div>
          )}

          {(activeSection !== "profile" && activeSection !== "notifications" && activeSection !== "company" && activeSection !== "integrations" && activeSection !== "directories" && activeSection !== "updates" && activeSection !== "appearance" && activeSection !== "documents" && activeSection !== "security") && (
            <div className="flex h-64 items-center justify-center rounded-2xl bg-card shadow-sm">
              <div className="text-center">
                <Settings className="mx-auto mb-4 h-12 w-12 text-muted-foreground/50" />
                <p className="text-muted-foreground">Раздел в разработке</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <Dialog open={createUserOpen} onOpenChange={(open) => !createUserLoading && setCreateUserOpen(open)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Новый пользователь</DialogTitle>
            <DialogDescription>
              Пользователь сразу сможет войти на сайт (логин + пароль) и его можно назначить оператором на ТСД.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <label className="text-sm font-medium text-foreground">
              Login
              <Input
                value={createUserForm.login}
                onChange={(e) => setCreateUserForm((p) => ({ ...p, login: e.target.value }))}
                disabled={createUserLoading}
                className="rounded-xl"
                autoComplete="off"
              />
            </label>
            <label className="text-sm font-medium text-foreground">
              Имя
              <Input
                value={createUserForm.displayName}
                onChange={(e) => setCreateUserForm((p) => ({ ...p, displayName: e.target.value }))}
                disabled={createUserLoading}
                className="rounded-xl"
              />
            </label>
            <label className="text-sm font-medium text-foreground">
              Пароль
              <Input
                type="password"
                value={createUserForm.password}
                onChange={(e) => setCreateUserForm((p) => ({ ...p, password: e.target.value }))}
                disabled={createUserLoading}
                className="rounded-xl"
                autoComplete="new-password"
              />
            </label>
            <label className="text-sm font-medium text-foreground">
              Должность (необязательно)
              <Input
                value={createUserForm.position}
                onChange={(e) => setCreateUserForm((p) => ({ ...p, position: e.target.value }))}
                disabled={createUserLoading}
                className="rounded-xl"
                placeholder="Начальник склада"
              />
            </label>
            <label className="text-sm font-medium text-foreground">
              Телефон (необязательно)
              <Input
                value={createUserForm.phone}
                onChange={(e) => setCreateUserForm((p) => ({ ...p, phone: e.target.value }))}
                disabled={createUserLoading}
                className="rounded-xl"
              />
            </label>
            <label className="text-sm font-medium text-foreground">
              Внешний код (необязательно)
              <Input
                value={createUserForm.externalCode}
                onChange={(e) => setCreateUserForm((p) => ({ ...p, externalCode: e.target.value }))}
                disabled={createUserLoading}
                className="rounded-xl"
              />
            </label>
            <div>
              <div className="mb-2 text-sm font-medium text-foreground">Роли</div>
              <div className="flex flex-wrap gap-2">
                {WMS_ROLE_OPTIONS.map((opt) => (
                  <Button
                    key={opt.code}
                    type="button"
                    size="sm"
                    variant={createUserForm.roleCodes.includes(opt.code) ? "default" : "outline"}
                    className="rounded-lg"
                    disabled={createUserLoading}
                    onClick={() => toggleCreateUserRole(opt.code)}
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>
            </div>
            {createUserError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-sm text-destructive">
                {createUserError}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateUserOpen(false)} disabled={createUserLoading}>
              Отмена
            </Button>
            <Button className="bg-primary text-primary-foreground" onClick={() => void submitCreateUser()} disabled={createUserLoading}>
              {createUserLoading ? "Создание…" : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(passwordUser)} onOpenChange={(open) => !passwordLoading && !open && setPasswordUser(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Сменить пароль</DialogTitle>
            <DialogDescription>
              {passwordUser
                ? `Новый пароль для ${passwordUser.displayName} (${passwordUser.login}).`
                : "Новый пароль пользователя."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <label className="text-sm font-medium text-foreground">
              Новый пароль
              <Input
                type="password"
                value={passwordValue}
                onChange={(e) => setPasswordValue(e.target.value)}
                disabled={passwordLoading}
                className="rounded-xl"
                autoComplete="new-password"
                autoFocus
              />
            </label>
            {passwordError ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-sm text-destructive">
                {passwordError}
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasswordUser(null)} disabled={passwordLoading}>
              Отмена
            </Button>
            <Button className="bg-primary text-primary-foreground" onClick={() => void submitPasswordChange()} disabled={passwordLoading}>
              {passwordLoading ? "Сохраняем…" : "Сменить пароль"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
