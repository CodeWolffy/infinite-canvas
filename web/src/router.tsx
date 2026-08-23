import { createBrowserRouter, Navigate, Outlet } from "react-router-dom";

import { AdminGuard, AuthGuard } from "@/components/auth/auth-guard";
import { AnalyticsTracker } from "@/components/layout/analytics-tracker";
import AdminLayout from "@/layouts/admin-layout";
import UserLayout from "@/layouts/user-layout";
import AdminAssetsPage from "@/pages/admin/assets";
import AdminChannelsPage from "@/pages/admin/channels";
import AdminLogsPage from "@/pages/admin/logs";
import AdminModelsPage from "@/pages/admin/models";
import AdminStatsPage from "@/pages/admin/stats";
import AdminUsersPage from "@/pages/admin/users";
import AssetsPage from "@/pages/assets";
import CanvasPage from "@/pages/canvas";
import CanvasProjectPage from "@/pages/canvas/project";
import ChangePasswordPage from "@/pages/change-password";
import HomePage from "@/pages/home";
import ImagePage from "@/pages/image";
import LoginPage from "@/pages/login";
import NotFound from "@/pages/not-found";
import PromptsPage from "@/pages/prompts";

export const router = createBrowserRouter([
    { path: "/login", element: <LoginPage /> },
    {
        element: (
            <AuthGuard>
                <Outlet />
            </AuthGuard>
        ),
        children: [
            { path: "/change-password", element: <ChangePasswordPage /> },
            {
                element: (
                    <UserLayout>
                        <AnalyticsTracker />
                        <Outlet />
                    </UserLayout>
                ),
                children: [
                    { path: "/", element: <HomePage /> },
                    { path: "/image", element: <ImagePage /> },
                    { path: "/assets", element: <AssetsPage /> },
                    { path: "/prompts", element: <PromptsPage /> },
                    { path: "/canvas", element: <CanvasPage /> },
                    { path: "/canvas/:id", element: <CanvasProjectPage /> },
                ],
            },
            {
                path: "/admin",
                element: <AdminGuard><AdminLayout /></AdminGuard>,
                children: [
                    { index: true, element: <Navigate to="users" replace /> },
                    { path: "users", element: <AdminUsersPage /> },
                    { path: "models", element: <AdminModelsPage /> },
                    { path: "channels", element: <AdminChannelsPage /> },
                    { path: "logs", element: <AdminLogsPage /> },
                    { path: "assets", element: <AdminAssetsPage /> },
                    { path: "stats", element: <AdminStatsPage /> },
                ],
            },
            { path: "*", element: <NotFound /> },
        ],
    },
]);
