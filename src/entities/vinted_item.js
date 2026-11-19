const str = (v, fallback = "N/A") =>
    typeof v === "string" && v.trim() ? v : fallback;

class VintedPhoto {
    constructor(photo) {
        this.id = Number(photo?.id) || 0;
        this.width = Number(photo?.width) || 0;
        this.height = Number(photo?.height) || 0;
        this.url = str(photo?.url, "");
        this.fullSizeUrl = str(photo?.full_size_url, this.url);
    }
}

class VintedUser {
    constructor(userData, domain) {
        this.id = Number(userData?.id) || 0;
        this.login = str(userData?.login);
        this.business = Boolean(userData?.business);
        this.url = this.id ? `https://www.vinted.${domain}/member/${this.id}` : null;
    }
}

/**
 * Item built from a svc-catalogue/items entry (September 2026 format).
 * That payload has no description, category, brand/size ids, seller country,
 * seller rating or timestamps; brand/size/condition come from item_box.
 */
class VintedItem {
    constructor(itemData, domain = "fr") {
        this.domain = domain;
        this.id = Number(itemData.id) || 0;
        this.title = str(itemData.title);

        this.path = str(itemData.url, `/items/${this.id}`);
        this.url = /^https?:\/\//.test(this.path)
            ? this.path
            : `https://www.vinted.${domain}${this.path}`;

        this.priceNumeric = parseFloat(itemData.price?.amount) || 0;
        this.totalPriceNumeric = parseFloat(itemData.total_item_price?.amount) || 0;
        this.currency = str(itemData.price?.currency_code, "");

        const box = itemData.item_box ?? {};
        // first_line is the brand, only present when it differs from the title.
        this.brand =
            box.first_line && box.first_line !== itemData.title ? box.first_line : "N/A";

        // second_line is "size · condition", or just the condition when no size.
        const parts = str(box.second_line, "").split(" · ").filter(Boolean);
        if (parts.length >= 2) {
            this.size = parts[0];
            this.status = parts.slice(1).join(" · ");
        } else {
            this.size = "N/A";
            this.status = parts[0] ?? "N/A";
        }

        const rawPhotos = Array.isArray(itemData.photos) && itemData.photos.length
            ? itemData.photos
            : itemData.photo ? [itemData.photo] : [];
        this.photos = rawPhotos.map((p) => new VintedPhoto(p));

        this.user = new VintedUser(itemData.user, domain);
    }
}

export { VintedItem, VintedPhoto };