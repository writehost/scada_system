package com.scadatable.wms.navigation

import androidx.compose.runtime.Composable
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import com.scadatable.wms.ui.components.SupportSessionHost
import com.scadatable.wms.ui.screens.*

sealed class Screen(val route: String) {
    object Main : Screen("main")
    object Tasks : Screen("tasks")
    object Notifications : Screen("notifications")
    object Nomenclature : Screen("nomenclature")
    object ProductionPlans : Screen("production_plans")
    object Receiving : Screen("receiving")
    object ReceivingSession : Screen("receiving_session/{productGroup}/{docId}") {
        fun createRoute(productGroup: String, docId: String) = "receiving_session/$productGroup/$docId"
    }
    object ManualReceiving : Screen("manual_receiving/{productGroup}/{docId}") {
        fun createRoute(productGroup: String, docId: String) = "manual_receiving/$productGroup/$docId"
    }
    object ManualReceivingDocument : Screen("manual_receiving_document/{productGroup}") {
        fun createRoute(productGroup: String) = "manual_receiving_document/$productGroup"
    }
    object ReceivingDocuments : Screen("receiving_documents/{productGroup}") {
        fun createRoute(productGroup: String) = "receiving_documents/$productGroup"
        fun allDocumentsRoute() = createRoute(com.scadatable.wms.receiving.ReceivingProductGroups.ALL_DOCS)
    }
    object ReceivingCategory : Screen("receiving_category/{categoryKey}") {
        fun createRoute(categoryKey: String) = "receiving_category/$categoryKey"
    }
    object DocumentWizard : Screen("document_wizard?preset={preset}") {
        fun createRoute(preset: String = "receiving") =
            "document_wizard?preset=${android.net.Uri.encode(preset.trim().ifBlank { "receiving" })}"
    }
    object Movement : Screen("movement?itemCode={itemCode}&fromLocationCode={fromLocationCode}") {
        fun createRoute(itemCode: String? = null, fromLocationCode: String? = null): String {
            val item = itemCode?.trim().orEmpty()
            val from = fromLocationCode?.trim().orEmpty()
            return "movement?itemCode=${android.net.Uri.encode(item)}&fromLocationCode=${android.net.Uri.encode(from)}"
        }
    }
    object Putaway : Screen("putaway")
    object LpnNest : Screen("lpn_nest")
    object FreeReceiving : Screen("free_receiving?location={location}&lpn={lpn}") {
        fun createRoute(location: String = "", lpn: String = ""): String {
            return "free_receiving?location=${android.net.Uri.encode(location.trim())}&lpn=${android.net.Uri.encode(lpn.trim())}"
        }
    }
    object Issue : Screen("issue")
    object IssueManual : Screen("issue_manual/{productGroup}") {
        fun createRoute(productGroup: String) = "issue_manual/$productGroup"
    }
    object Inventory : Screen("inventory")
    object WarehouseMaterials : Screen("warehouse_materials")
    object WarehouseFinishedGoods : Screen("warehouse_finished")
    object MaterialWarehouseCategory : Screen("warehouse_category/{kind}/{categoryKey}") {
        fun createRoute(kindRouteKey: String, categoryRouteKey: String) =
            "warehouse_category/$kindRouteKey/$categoryRouteKey"
    }
    object MaterialWarehouseStock : Screen("warehouse_stock/{kind}/{productGroup}") {
        fun createRoute(kindRouteKey: String, productGroupRouteKey: String) =
            "warehouse_stock/$kindRouteKey/$productGroupRouteKey"
    }
    object Aggregation : Screen("aggregation")
    object AggregationSession : Screen("aggregation/{mode}") {
        fun createRoute(modeRouteKey: String) = "aggregation/$modeRouteKey"
    }
    object Scan : Screen("scan")
    object ScanHistory : Screen("scan_history")
    object CollectDocuments : Screen("collect_documents")
    object CreateCodeWizard : Screen("create_code_wizard")
    object Settings : Screen("settings")
}

@Composable
fun WmsNavGraph(navController: NavHostController) {
    SupportSessionHost(navController = navController) {
        NavHost(
            navController = navController,
            startDestination = Screen.Main.route
        ) {
        composable(Screen.Main.route) { MainScreen(navController) }
        composable(Screen.Tasks.route) { TasksScreen(navController) }
        composable(Screen.Notifications.route) { NotificationsScreen(navController) }
        composable(Screen.Nomenclature.route) { NomenclatureScreen(navController) }
        composable(Screen.ProductionPlans.route) { ProductionPlansScreen(navController) }
        composable(Screen.Receiving.route) { ReceivingGroupPickerScreen(navController) }
        composable(
            route = Screen.DocumentWizard.route,
            arguments = listOf(
                navArgument("preset") {
                    type = NavType.StringType
                    defaultValue = "receiving"
                },
            ),
        ) { backStackEntry ->
            DocumentWizardScreen(
                navController = navController,
                presetType = backStackEntry.arguments?.getString("preset").orEmpty().ifBlank { "receiving" },
            )
        }
        composable(
            route = Screen.ReceivingCategory.route,
            arguments = listOf(navArgument("categoryKey") { type = NavType.StringType }),
        ) { backStackEntry ->
            val categoryKey = backStackEntry.arguments?.getString("categoryKey").orEmpty()
            ReceivingCategoryGroupsScreen(navController = navController, categoryKey = categoryKey)
        }
        composable(
            route = Screen.ReceivingSession.route,
            arguments = listOf(
                navArgument("productGroup") { type = NavType.StringType },
                navArgument("docId") { type = NavType.StringType },
            ),
        ) { backStackEntry ->
            val productGroup = backStackEntry.arguments?.getString("productGroup").orEmpty()
            val docId = backStackEntry.arguments?.getString("docId").orEmpty()
            ReceivingScreen(navController = navController, productGroup = productGroup, docId = docId)
        }
        composable(
            route = Screen.ManualReceiving.route,
            arguments = listOf(
                navArgument("productGroup") { type = NavType.StringType },
                navArgument("docId") { type = NavType.StringType },
            ),
        ) { backStackEntry ->
            val productGroup = backStackEntry.arguments?.getString("productGroup").orEmpty()
            val docId = backStackEntry.arguments?.getString("docId").orEmpty()
            ManualReceivingScreen(navController = navController, productGroup = productGroup, docId = docId)
        }
        composable(
            route = Screen.ManualReceivingDocument.route,
            arguments = listOf(navArgument("productGroup") { type = NavType.StringType }),
        ) { backStackEntry ->
            val productGroup = backStackEntry.arguments?.getString("productGroup").orEmpty()
            ManualReceivingDocumentScreen(navController = navController, productGroup = productGroup)
        }
        composable(
            route = Screen.ReceivingDocuments.route,
            arguments = listOf(navArgument("productGroup") { type = NavType.StringType }),
        ) { backStackEntry ->
            val productGroup = backStackEntry.arguments?.getString("productGroup").orEmpty()
            ReceivingDocumentsScreen(navController = navController, productGroup = productGroup)
        }
        composable(
            route = Screen.Movement.route,
            arguments = listOf(
                navArgument("itemCode") {
                    type = NavType.StringType
                    defaultValue = ""
                },
                navArgument("fromLocationCode") {
                    type = NavType.StringType
                    defaultValue = ""
                },
            ),
        ) { backStackEntry ->
            MovementScreen(
                navController = navController,
                prefillItemCode = backStackEntry.arguments?.getString("itemCode").orEmpty(),
                prefillFromLocation = backStackEntry.arguments?.getString("fromLocationCode").orEmpty(),
            )
        }
        composable(Screen.Putaway.route) { PutawayScreen(navController) }
        composable(Screen.LpnNest.route) { LpnNestScreen(navController) }
        composable(
            route = Screen.FreeReceiving.route,
            arguments = listOf(
                navArgument("location") {
                    type = NavType.StringType
                    defaultValue = ""
                },
                navArgument("lpn") {
                    type = NavType.StringType
                    defaultValue = ""
                },
            ),
        ) { backStackEntry ->
            FreeReceivingScreen(
                navController = navController,
                prefillLocation = backStackEntry.arguments?.getString("location").orEmpty(),
                prefillLpn = backStackEntry.arguments?.getString("lpn").orEmpty(),
            )
        }
        composable(Screen.Issue.route) { IssueGroupPickerScreen(navController) }
        composable(
            route = Screen.IssueManual.route,
            arguments = listOf(navArgument("productGroup") { type = NavType.StringType }),
        ) { backStackEntry ->
            val productGroup = backStackEntry.arguments?.getString("productGroup").orEmpty()
            IssueManualScreen(navController = navController, productGroup = productGroup)
        }
        composable(Screen.Inventory.route) { WarehousePickerScreen(navController) }
        composable(Screen.WarehouseMaterials.route) {
            MaterialWarehouseGroupPickerScreen(navController, com.scadatable.wms.warehouse.WarehouseKind.MATERIALS)
        }
        composable(Screen.WarehouseFinishedGoods.route) {
            MaterialWarehouseGroupPickerScreen(navController, com.scadatable.wms.warehouse.WarehouseKind.FINISHED_GOODS)
        }
        composable(
            route = Screen.MaterialWarehouseCategory.route,
            arguments = listOf(
                navArgument("kind") { type = NavType.StringType },
                navArgument("categoryKey") { type = NavType.StringType },
            ),
        ) { backStackEntry ->
            MaterialWarehouseCategoryGroupsScreen(
                navController = navController,
                kindRouteKey = backStackEntry.arguments?.getString("kind").orEmpty(),
                categoryRouteKey = backStackEntry.arguments?.getString("categoryKey").orEmpty(),
            )
        }
        composable(
            route = Screen.MaterialWarehouseStock.route,
            arguments = listOf(
                navArgument("kind") { type = NavType.StringType },
                navArgument("productGroup") { type = NavType.StringType },
            ),
        ) { backStackEntry ->
            val kind = backStackEntry.arguments?.getString("kind").orEmpty()
            val productGroup = backStackEntry.arguments?.getString("productGroup").orEmpty()
            MaterialWarehouseStockScreen(
                navController = navController,
                warehouseKindRouteKey = kind,
                productGroupRouteKey = productGroup,
            )
        }
        composable(Screen.Aggregation.route) { AggregationPickerScreen(navController) }
        composable(
            route = Screen.AggregationSession.route,
            arguments = listOf(navArgument("mode") { type = NavType.StringType }),
        ) { backStackEntry ->
            val mode = backStackEntry.arguments?.getString("mode").orEmpty()
            AggregationScreen(navController = navController, modeRouteKey = mode)
        }
        composable(Screen.Scan.route) { ScanScreen(navController) }
        composable(Screen.ScanHistory.route) { ScanHistoryScreen(navController) }
        composable(Screen.CollectDocuments.route) { CollectDocumentsScreen(navController) }
        composable(Screen.CreateCodeWizard.route) { CreateCodeWizardScreen(navController) }
        composable(Screen.Settings.route) { SettingsScreen(navController) }
        }
    }
}
