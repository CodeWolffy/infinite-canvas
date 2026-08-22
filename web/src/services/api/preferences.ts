import { apiRequest } from "@/services/api/request";

export async function getPreferences<T extends Record<string, unknown>>() {
    return (await apiRequest<{ preferences: T }>("/api/preferences")).preferences;
}

export async function savePreferences<T extends Record<string, unknown>>(preferences: T) {
    return (await apiRequest<{ preferences: T }>("/api/preferences", { method: "PUT", body: preferences })).preferences;
}

export async function getAnnouncement() {
    return (await apiRequest<{ content: string }>("/api/announcement")).content;
}

export async function updateAnnouncement(content: string) {
    return (await apiRequest<{ content: string }>("/api/admin/announcement", { method: "PUT", body: { content } })).content;
}
