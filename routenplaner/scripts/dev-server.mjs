// Kleiner statischer Server für die lokale Vorschau (die Seite braucht HTTP,
// weil sie data/*.json per fetch lädt).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const ROOT = process.cwd();
const TYPEN = { ".html": "text/html; charset=utf-8", ".json": "application/json", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };

createServer(async (req, res) => {
  let pfad = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
  if (pfad.endsWith("/")) pfad += "index.html";
  try {
    const inhalt = await readFile(join(ROOT, pfad));
    res.writeHead(200, { "Content-Type": TYPEN[extname(pfad)] || "application/octet-stream" });
    res.end(inhalt);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("nicht gefunden: " + pfad);
  }
}).listen(8731, () => console.log("Vorschau auf http://localhost:8731/routenplaner/"));
