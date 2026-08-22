import { apiRequest, ApiError } from "@/services/api/request";

export type MediaRecord = {
    id: string;
    originalName: string;
    mimeType: string;
    byteSize: number;
    width: number | null;
    height: number | null;
    createdAt: string;
    url: string;
};

export type StorageUsage = { totalCount: number; totalBytes: number };

export async function getMyStorageUsage() {
    const stats = await apiRequest<StorageUsage>("/api/media/stats");
    return { totalCount: Number(stats.totalCount), totalBytes: Number(stats.totalBytes) };
}

export function mediaId(storageKey: string) {
    return storageKey.replace(/^image:/, "");
}

export async function uploadMedia(file: Blob, fileName = "image.png") {
    const body = new FormData();
    body.set("file", file, fileName);
    const response = await fetch("/api/media", { method: "POST", body, credentials: "include" });
    if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string; message?: string } | null;
        if (response.status === 401) window.dispatchEvent(new Event("auth:unauthorized"));
        if (payload?.error === "password_change_required") window.dispatchEvent(new Event("auth:password-change-required"));
        throw new ApiError(payload?.message || `请求失败（HTTP ${response.status}）`, response.status, payload?.error);
    }
    return ((await response.json()) as { media: MediaRecord }).media;
}

export function mediaUrl(id: string) {
    return `/api/media/${mediaId(id)}`;
}

export async function readMedia(id: string) {
    const response = await fetch(mediaUrl(id), { credentials: "include" });
    if (response.status === 401) window.dispatchEvent(new Event("auth:unauthorized"));
    if (!response.ok) throw new ApiError(`读取文件失败（HTTP ${response.status}）`, response.status);
    return response.blob();
}

export async function deleteMedia(id: string) {
    const response = await fetch(mediaUrl(id), { method: "DELETE", credentials: "include" });
    if (response.status === 204 || response.status === 404 || response.status === 409) return;
    throw new ApiError(`删除文件失败（HTTP ${response.status}）`, response.status);
}
