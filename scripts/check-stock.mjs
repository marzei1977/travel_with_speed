// Prüft regelmäßig, ob "Midea Portasplit" bei B&Q und Screwfix gelistet/vorrätig ist.
// Läuft ohne externe Abhängigkeiten (nutzt Node's eingebautes fetch, Node 18+).

import { writeFile, readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

const SEARCH_TERM = "midea portasplit";
const USER_AGENT =
  "Mozilla/5.0 (compatible; PortasplitStockChecker/1.0; +https://github.com/) Node.js stock-check script";
const REQUEST_TIMEOUT_MS = 15_000;
const DELAY_BETWEEN_REQUESTS_MS = 1_500;

const RETAILERS = [
  {
    key: "bq",
    name: "B&Q",
    base: "https://www.diy.com",
    searchUrl: `https://www.diy.com/search?term=${encodeURIComponent(SEARCH_TERM)}`,
  },
  {
    key: "screwfix",
    name: "Screwfix",
    base: "https://www.screwfix.com",
    searchUrl: `https://www.screwfix.com/search?search=${encodeURIComponent(SEARCH_TERM)}`,
  },
];

async function fetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} für ${url}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// Extrahiert alle <script type="application/ld+json">-Blöcke aus einer HTML-Seite.
function extractLdJsonBlocks(html) {
  const blocks = [];
  const regex = /<script type="application\/ld\+json"[^>]*>(.*?)<\/script>/gis;
  let m;
  while ((m = regex.exec(html)) !== null) {
    try {
      blocks.push(JSON.parse(m[1]));
    } catch {
      // ungültiges/unvollständiges JSON überspringen
    }
  }
  return blocks;
}

function findItemList(blocks) {
  for (const b of blocks) {
    if (b && b["@type"] === "ItemList" && Array.isArray(b.itemListElement)) {
      return b.itemListElement;
    }
  }
  return [];
}

function findProduct(blocks) {
  for (const b of blocks) {
    if (b && b["@type"] === "Product") return b;
  }
  return null;
}

function normalizeOffers(offers) {
  const list = Array.isArray(offers) ? offers : offers ? [offers] : [];
  return list.map((o) => ({
    method: (o.description || o.availableDeliveryMethod || "").replace(
      "https://schema.org/",
      ""
    ),
    availability: (o.availability || "").replace("https://schema.org/", ""),
    price: o.price ?? null,
  }));
}

async function checkRetailer(retailer) {
  const result = {
    key: retailer.key,
    name: retailer.name,
    searchUrl: retailer.searchUrl,
    found: false,
    products: [],
    error: null,
  };

  try {
    const html = await fetchHtml(retailer.searchUrl);
    const blocks = extractLdJsonBlocks(html);
    const items = findItemList(blocks);
    const matches = items.filter((item) =>
      /portasplit/i.test(item.name || "")
    );

    for (const match of matches) {
      await sleep(DELAY_BETWEEN_REQUESTS_MS);
      const productUrl = new URL(match.url, retailer.base).href;

      const product = {
        name: match.name,
        url: productUrl,
        price: match.offers?.price ?? null,
        inStock: null,
        offers: [],
      };

      try {
        const productHtml = await fetchHtml(productUrl);
        const productBlocks = extractLdJsonBlocks(productHtml);
        const productData = findProduct(productBlocks);
        const offers = normalizeOffers(productData?.offers);
        product.offers = offers;
        product.inStock = offers.some((o) => o.availability === "InStock");
      } catch (err) {
        product.error = err.message;
      }

      result.products.push(product);
    }

    result.found = result.products.length > 0;
  } catch (err) {
    result.error = err.message;
  }

  return result;
}

async function main() {
  const retailerResults = [];
  for (const retailer of RETAILERS) {
    retailerResults.push(await checkRetailer(retailer));
    await sleep(DELAY_BETWEEN_REQUESTS_MS);
  }

  const status = {
    query: SEARCH_TERM,
    updatedAt: new Date().toISOString(),
    retailers: retailerResults,
  };

  await writeFile(
    new URL("../data/status.json", import.meta.url),
    JSON.stringify(status, null, 2) + "\n",
    "utf-8"
  );

  const summary = retailerResults
    .map((r) => `${r.name}: ${r.error ? "Fehler - " + r.error : r.found ? `${r.products.length} Treffer` : "nicht gelistet"}`)
    .join(" | ");
  console.log(summary);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
