import { create } from "zustand";

import * as authApi from "@/services/api/auth";
import type { AuthUser } from "@/services/api/auth";
import { ApiError } from "@/services/api/request";

type UserStore = {
    user: AuthUser | null;
    status: "idle" | "loading" | "authenticated" | "unauthenticated" | "error";
    error: string;
    initialize: () => Promise<void>;
    login: (input: { username: string; password: string }) => Promise<AuthUser>;
    changePassword: (input: { currentPassword: string; newPassword: string }) => Promise<AuthUser>;
    logout: () => Promise<void>;
    clearSession: () => void;
    requirePasswordChange: () => void;
};

export const useUserStore = create<UserStore>()((set, get) => ({
    user: null,
    status: "idle",
    error: "",
    initialize: async () => {
        if (get().status !== "idle") return;
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
