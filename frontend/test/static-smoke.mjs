import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const output = join(process.cwd(), "out");
assert.ok(existsSync(join(output, "index.html")), "Missing static home page");
assert.ok(
  existsSync(join(output, "verify.html")) || existsSync(join(output, "verify", "index.html")),
  "Missing static verification page"
);
assert.ok(existsSync(join(output, "_headers")), "Cloudflare Pages security headers were not copied");
assert.ok(!existsSync(join(output, "api", "verify.json")), "A Pages Function/API route must not be present in static output");
assert.ok(!existsSync(join(output, "_worker.js")), "The static output must not contain a Cloudflare Worker");
assert.ok(!existsSync(join(output, "_routes.json")), "The static output must not configure function/worker routes");
assert.ok(!existsSync(join(output, "functions")), "The static output must not contain Cloudflare Pages Functions");
assert.ok(!existsSync(join(process.cwd(), "functions")), "The frontend project must not define Cloudflare Pages Functions");

const headers = readFileSync(join(output, "_headers"), "utf8");
assert.match(headers, /X-Content-Type-Options:\s*nosniff/i);
assert.match(headers, /Referrer-Policy:/i);

const assets = [];
function walk(directory) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) walk(path);
    else if (extname(path) === ".js") assets.push(readFileSync(path, "utf8"));
  }
}
walk(output);
const expectedBackend = process.env.NEXT_PUBLIC_BACKEND_BASE_URL;
assert.ok(expectedBackend, "Set NEXT_PUBLIC_BACKEND_BASE_URL for the static smoke test");
assert.ok(assets.some((asset) => asset.includes(expectedBackend)), "The browser bundle must include the configured backend origin");
assert.ok(assets.some((asset) => asset.includes("/endpoints/verification/status")), "The browser bundle must call the backend verification API directly");

const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
  const safePath = normalize(pathname).replace(/^([.][.][/\\])+/, "").replace(/^[/\\]+/, "");
  const candidate = join(output, safePath || "index.html");
  const choices = [candidate, `${candidate}.html`, join(candidate, "index.html")];
  const file = choices.find((choice) => existsSync(choice) && statSync(choice).isFile());
  if (!file) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  const extension = extname(file);
  response.writeHead(200, { "content-type": extension === ".html" ? "text/html; charset=utf-8" : "application/octet-stream" });
  response.end(readFileSync(file));
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const address = server.address();
assert.ok(address && typeof address !== "string");
try {
  for (const path of ["/", "/verify"]) {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`);
    assert.equal(response.status, 200, `${path} should load from the static site`);
    assert.match(await response.text(), /Preparing your secure verification|Entry verification/);
  }
  process.stdout.write("Static Pages output, direct backend bundle, routes, and no-Functions checks passed.\n");
} finally {
  await new Promise((resolve) => server.close(resolve));
}
