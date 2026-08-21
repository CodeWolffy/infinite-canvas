import { apiRequest } from "@/services/api/request";

export async function getPreferences<T extends Record<string, unknown>>() {
    return (await apiRequest<{ preferences: T }>("/api/preferences")).preferences;
}

export async function savePreferences<T extends Record<string, unknown>>(preferences: T) {
    return (await apiRequest<{ preferences: T }>("/api/preferences", { method: "PUT", body: preferences })).preferences;
}
