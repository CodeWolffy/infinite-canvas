import { create } from "zustand";
import i18n from "@/i18n";
import * as canvasApi from "@/services/api/canvas-projects";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";

export type CanvasProject = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
};

type CanvasStore = {
    hydrated: boolean;
    hydratedUserId: string;
    projects: CanvasProject[];
    hydrateProjects: (userId: string) => Promise<void>;
    createProject: (title?: string) => Promise<string>;
    importProject: (project: Partial<CanvasProject>) => Promise<string>;
    openProject: (id: string) => CanvasProject | null;
    renameProject: (id: string, title: string) => Promise<void>;
    deleteProjects: (ids: string[]) => Promise<void>;
    replaceProjects: (projects: CanvasProject[]) => void;
    updateProject: (id: string, patch: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport">>) => void;
    flushProject: (id: string) => Promise<void>;
};

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };
type CanvasSnapshot = Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport">;
const emptySnapshot = (): CanvasSnapshot => ({ nodes: [], connections: [], chatSessions: [], activeChatId: null, backgroundMode: "lines", showImageInfo: false, viewport: initialViewport });
const pendingUpdates = new Map<string, { title?: string; snapshot?: CanvasSnapshot }>();
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const savingProjects = new Map<string, Promise<void>>();
const deletingProjects = new Set<string>();
const hydratePromises = new Map<string, Promise<void>>();
const CANVAS_SAVE_DEBOUNCE_MS = 1000;

function projectSnapshot(project: CanvasProject): CanvasSnapshot {
    const { nodes, connections, chatSessions, activeChatId, backgroundMode, showImageInfo, viewport } = project;
    return { nodes, connections, chatSessions, activeChatId, backgroundMode, showImageInfo, viewport };
}

function normalizeProject(record: canvasApi.CanvasProjectRecord): CanvasProject {
    const snapshot = record.snapshot && typeof record.snapshot === "object" ? (record.snapshot as Partial<CanvasSnapshot>) : {};
    return { id: record.id, title: record.title, createdAt: record.createdAt, updatedAt: record.updatedAt, ...emptySnapshot(), ...snapshot };
}

function enqueueProjectUpdate(id: string, patch: { title?: string; snapshot?: CanvasSnapshot }) {
    if (!useCanvasStore.getState().hydrated) return;
    pendingUpdates.set(id, { ...pendingUpdates.get(id), ...patch });
    const timer = saveTimers.get(id);
    if (timer) clearTimeout(timer);
    saveTimers.set(id, setTimeout(() => void flushProjectUpdate(id), CANVAS_SAVE_DEBOUNCE_MS));
}

export async function flushProject(id: string) {
    return flushProjectUpdate(id);
}

async function flushProjectUpdate(id: string) {
    const timer = saveTimers.get(id);
    if (timer) clearTimeout(timer);
    saveTimers.delete(id);
    if (!useCanvasStore.getState().hydrated) {
        pendingUpdates.delete(id);
        return;
    }
    if (savingProjects.has(id)) return;
    const patch = pendingUpdates.get(id);
    if (!patch) return;
    pendingUpdates.delete(id);
    let failed = false;
    const request = canvasApi
        .updateCanvasProject(id, patch)
        .then((record) => useCanvasStore.setState((state) => ({ projects: state.projects.map((project) => (project.id === id ? { ...project, updatedAt: record.updatedAt } : project)) })))
        .catch(() => {
            failed = true;
            if (!deletingProjects.has(id)) {
                pendingUpdates.set(id, { ...patch, ...pendingUpdates.get(id) });
                saveTimers.set(id, setTimeout(() => void flushProjectUpdate(id), 2000));
            }
        })
        .finally(() => {
            savingProjects.delete(id);
            if (!failed && pendingUpdates.has(id)) void flushProjectUpdate(id);
        });
    savingProjects.set(id, request);
    await request;
}

function cancelProjectUpdate(id: string) {
    const timer = saveTimers.get(id);
    if (timer) clearTimeout(timer);
    saveTimers.delete(id);
    pendingUpdates.delete(id);
}

export const useCanvasStore = create<CanvasStore>()((set, get) => ({
            hydrated: false,
            hydratedUserId: "",
            projects: [],
            hydrateProjects: async (userId) => {
                if (get().hydrated && get().hydratedUserId === userId) return;
                if (get().hydratedUserId !== userId) set({ projects: [], hydrated: false, hydratedUserId: userId });
                let request = hydratePromises.get(userId);
                if (!request) {
                    request = canvasApi.listCanvasProjects().then((records) => { if (get().hydratedUserId === userId) set({ projects: records.map(normalizeProject), hydrated: true }); }).finally(() => { hydratePromises.delete(userId); });
                    hydratePromises.set(userId, request);
                }
                await request;
            },
            createProject: async (title = i18n.t("canvas.project.untitled")) => {
                const project = normalizeProject(await canvasApi.createCanvasProject({ title, snapshot: emptySnapshot() }));
                set((state) => ({ projects: [project, ...state.projects] }));
                return project.id;
            },
            importProject: async (source) => {
                const snapshot: CanvasSnapshot = {
                    nodes: source.nodes || [],
                    connections: source.connections || [],
                    chatSessions: source.chatSessions || [],
                    activeChatId: source.activeChatId || null,
                    backgroundMode: source.backgroundMode || "lines",
                    showImageInfo: source.showImageInfo || false,
                    viewport: source.viewport || initialViewport,
                };
                const project = normalizeProject(await canvasApi.createCanvasProject({ title: source.title || i18n.t("canvas.project.imported"), snapshot }));
                set((state) => ({ projects: [project, ...state.projects] }));
                return project.id;
            },
            openProject: (id) => {
                return get().projects.find((item) => item.id === id) || null;
            },
            renameProject: async (id, title) => {
                const project = get().projects.find((item) => item.id === id);
                if (!project) return;
                const nextTitle = title.trim() || project.title;
                set((state) => ({
                    projects: state.projects.map((item) => (item.id === id ? { ...item, title: nextTitle, updatedAt: new Date().toISOString() } : item)),
                }));
                if (get().hydrated) enqueueProjectUpdate(id, { title: nextTitle });
            },
            deleteProjects: async (ids) => {
                ids.forEach((id) => deletingProjects.add(id));
                ids.forEach(cancelProjectUpdate);
                try {
                    await Promise.all(ids.map((id) => savingProjects.get(id)).filter((request): request is Promise<void> => Boolean(request)));
                    ids.forEach(cancelProjectUpdate);
                    await Promise.all(ids.map(canvasApi.deleteCanvasProject));
                    set((state) => ({ projects: state.projects.filter((project) => !ids.includes(project.id)) }));
                } finally {
                    ids.forEach((id) => deletingProjects.delete(id));
                }
            },
            replaceProjects: (projects) => set({ projects }),
            updateProject: (id, patch) => {
                let updated: CanvasProject | undefined;
                set((state) => ({
                    projects: state.projects.map((project) => {
                        if (project.id !== id) return project;
                        updated = { ...project, ...patch, updatedAt: new Date().toISOString() };
                        return updated;
                    }),
                }));
                if (updated && get().hydrated) enqueueProjectUpdate(id, { snapshot: projectSnapshot(updated) });
            },
            flushProject: async (id) => flushProject(id),
}));
