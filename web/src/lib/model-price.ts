export type ModelPricing = {
    capability?: "image" | "video" | "text" | "audio" | string | null;
    price?: string | null;
    pricePerImage?: string | null;
    inputPricePerMillion?: string | null;
    cachedPricePerMillion?: string | null;
    outputPricePerMillion?: string | null;
    pricePerSecond?: string | null;
};

export function formatModelPrice(price?: string | number | null): string {
    if (price == null || price === "") return "";
    const num = typeof price === "number" ? price : parseFloat(price);
    if (isNaN(num)) return String(price);
    return Number(num.toFixed(6)).toString();
}

export function modelPriceLabel(model: ModelPricing): string | null {
    if (model.inputPricePerMillion != null && model.inputPricePerMillion !== "") {
        const cached = model.cachedPricePerMillion == null || model.cachedPricePerMillion === "" ? "" : ` / 缓存 ¥${model.cachedPricePerMillion}`;
        return `输入 ¥${model.inputPricePerMillion}${cached} / 输出 ¥${model.outputPricePerMillion} / 百万 token`;
    }
    if (model.pricePerSecond != null && model.pricePerSecond !== "") return `¥${model.pricePerSecond} / 秒`;
    const price = model.price ?? model.pricePerImage;
    return price == null || price === "" ? null : `¥${formatModelPrice(price)} / ${model.capability === "image" ? "张" : "次"}`;
}

