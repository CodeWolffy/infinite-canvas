import { apiRequest } from "@/services/api/request";

export type CanvasProjectRecord = {
    id: string;
    title: string;
    snapshot: unknown;
    createdAt: string;
    updatedAt: string;
};

export async function listCanvasProjects() {
    return (await apiRequest<{ projects: CanvasProjectRecord[] }>("/api/canvas-projects")).projects;
}

export async function getCanvasProject(id: string) {
    return (await apiRequest<{ project: CanvasProjectRecord }>(`/api/canvas-projects/${id}`)).project;
}

export async function createCanvasProject(input: { title: string; snapshot: unknown }) {
    return (await apiRequest<{ project: CanvasProjectRecord }>("/api/canvas-projects", { method: "POST", body: input })).project;
}

export async function updateCanvasProject(id: string, input: { title?: string; snapshot?: unknown }) {
    return (await apiRequest<{ project: CanvasProjectRecord }>(`/api/canvas-projects/${id}`, { method: "PUT", body: input })).project;
}

export async function deleteCanvasProject(id: string) {
    await apiRequest<void>(`/api/canvas-projects/${id}`, { method: "DELETE" });
}

export type CanvasProjectHistoryRecord = {
    id: string;
    title: string;
    note?: string | null;
    createdAt: string;
    nodeCount: number;
    connectionCount: number;
};

export async function listCanvasProjectHistory(id: string) {
    return (await apiRequest<{ history: CanvasProjectHistoryRecord[] }>(`/api/canvas-projects/${id}/history`)).history;
}

export async function createCanvasProjectSnapshot(id: string, note?: string) {
    return (await apiRequest<{ history: CanvasProjectHistoryRecord }>(`/api/canvas-projects/${id}/history`, { method: "POST", body: { note } })).history;
}

export async function restoreCanvasProjectHistory(id: string, historyId: string) {
    return (await apiRequest<{ project: CanvasProjectRecord }>(`/api/canvas-projects/${id}/history/${historyId}/restore`, { method: "POST" })).project;
}

