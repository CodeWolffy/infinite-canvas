import { apiRequest } from "@/services/api/request";

export type UserRole = "admin" | "user";
export type UserStatus = "active" | "disabled";

export type AuthUser = {
    id: string;
    username: string;
    displayName: string;
    role: UserRole;
    status: UserStatus;
    mustChangePassword: boolean;
    lastLoginAt: string | null;
    createdAt: string;
};

type UserResponse = { user: AuthUser };

export async function login(input: { username: string; password: string }) {
    return (await apiRequest<UserResponse>("/api/auth/login", { method: "POST", body: input })).user;
}

export async function getCurrentUser() {
    return (await apiRequest<UserResponse>("/api/auth/me")).user;
}

export async function changePassword(input: { currentPassword: string; newPassword: string }) {
    return (await apiRequest<UserResponse>("/api/auth/change-password", { method: "POST", body: input })).user;
}

export async function logout() {
    await apiRequest<void>("/api/auth/logout", { method: "POST" });
}
