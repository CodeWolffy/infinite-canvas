import { create } from "zustand";

import * as authApi from "@/services/api/auth";
import type { AuthUser } from "@/services/api/auth";
import { updateUserProfile } from "@/services/api/user-center";
import { ApiError } from "@/services/api/request";

type UserStore = {
    user: AuthUser | null;
    status: "idle" | "loading" | "authenticated" | "unauthenticated" | "error";
    error: string;
    initialize: () => Promise<void>;
    login: (input: { username: string; password: string }) => Promise<AuthUser>;
    changePassword: (input: { currentPassword: string; newPassword: string }) => Promise<AuthUser>;
    updateDisplayName: (displayName: string) => Promise<AuthUser>;
    logout: () => Promise<void>;
    clearSession: () => void;
    requirePasswordChange: () => void;
};

export const useUserStore = create<UserStore>()((set, get) => ({
    user: null,
    status: "idle",
    error: "",
    initialize: async () => {
        // 允许从 error 重新进入，否则启动时一次网络抖动就把用户永久踢到登录页。
        if (get().status !== "idle" && get().status !== "error") return;
        set({ status: "loading", error: "" });
        try {
            set({ user: await authApi.getCurrentUser(), status: "authenticated" });
        } catch (error) {
            if (error instanceof ApiError && error.status === 401) set({ user: null, status: "unauthenticated" });
            else set({ user: null, status: "error", error: error instanceof Error ? error.message : "无法连接到服务" });
        }
    },
    login: async (input) => {
        const user = await authApi.login(input);
        set({ user, status: "authenticated", error: "" });
        return user;
    },
    changePassword: async (input) => {
        const user = await authApi.changePassword(input);
        set({ user, status: "authenticated", error: "" });
        return user;
    },
    updateDisplayName: async (displayName) => {
        const user = await updateUserProfile({ displayName });
        set({ user });
        return user;
    },
    logout: async () => {
        try {
            await authApi.logout();
        } finally {
            set({ user: null, status: "unauthenticated", error: "" });
        }
    },
    clearSession: () => set({ user: null, status: "unauthenticated", error: "" }),
    requirePasswordChange: () => set((state) => ({ user: state.user ? { ...state.user, mustChangePassword: true } : null })),
}));
