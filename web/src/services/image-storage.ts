import i18n from "@/i18n";
import { readImageMeta } from "@/lib/image-utils";
import { mediaUrl, readMedia, uploadMedia } from "@/services/api/media";

export type UploadedImage = {
    url: string;
    storageKey: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};

export async function uploadImage(input: string | Blob): Promise<UploadedImage> {
    const blob = typeof input === "string" ? await (await fetch(input)).blob() : input;
    const previewUrl = URL.createObjectURL(blob);
    const meta = await readImageMeta(previewUrl);
    URL.revokeObjectURL(previewUrl);
    const existingId = typeof input === "string" ? input.match(/\/api\/media\/([0-9a-f-]{36})(?:\b|\/|\?|#)/i)?.[1] : undefined;
    if (existingId) {
        return { url: mediaUrl(existingId), storageKey: `image:${existingId}`, width: meta.width, height: meta.height, bytes: blob.size, mimeType: blob.type || meta.mimeType };
    }
    const media = await uploadMedia(blob, input instanceof File ? input.name : `image.${meta.mimeType.split("/")[1] || "png"}`);
    return { url: media.url, storageKey: `image:${media.id}`, width: media.width || meta.width, height: media.height || meta.height, bytes: media.byteSize, mimeType: media.mimeType || meta.mimeType };
}

export async function resolveImageUrl(storageKey?: string, fallback = "") {
    return storageKey ? mediaUrl(storageKey) : fallback;
}

export async function getImageBlob(storageKey: string) {
    return readMedia(storageKey);
}

export async function setImageBlob(_storageKey: string, blob: Blob) {
    return (await uploadImage(blob)).url;
}

export async function imageToDataUrl(image: { url?: string; dataUrl?: string; storageKey?: string }) {
    const url = image.dataUrl && !image.dataUrl.startsWith("blob:") ? image.dataUrl : await resolveImageUrl(image.storageKey, image.url || "");
    if (!url || url.startsWith("data:")) return url;
    return blobToDataUrl(await (await fetch(url)).blob());
}

export async function deleteStoredImages(keys: Iterable<string>) {
    void keys;
}

export async function cleanupUnusedImages(_usedData: unknown) {}

export function collectImageStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey.startsWith("image:")) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectImageStorageKeys(child, keys)) : collectImageStorageKeys(item, keys)));
    return keys;
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error(i18n.t("common.imageReadFailed")));
        reader.readAsDataURL(blob);
    });
}
