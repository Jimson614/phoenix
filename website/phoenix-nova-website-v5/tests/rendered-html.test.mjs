import assert from "node:assert/strict";
import test from "node:test";

const workerUrl = new URL("../dist/server/index.js", import.meta.url);
workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
const { default: worker } = await import(workerUrl.href);

const env = {
  ASSETS: {
    fetch: async () => new Response("Not found", { status: 404 }),
  },
};

const ctx = {
  waitUntil() {},
  passThroughOnException() {},
};

async function get(path) {
  return worker.fetch(new Request(`http://localhost${path}`, {
    headers: { accept: "text/html" },
    redirect: "manual",
  }), env, ctx);
}

test("redirects the root to the Chinese master route", async () => {
  const response = await get("/");
  assert.ok([301, 302, 307, 308].includes(response.status));
  assert.equal(new URL(response.headers.get("location"), "http://localhost").pathname, "/zh");
});

test("renders the bilingual V5 portal home with noindex", async () => {
  const zh = await get("/zh");
  const en = await get("/en");

  assert.equal(zh.status, 200);
  assert.equal(en.status, 200);

  const zhHtml = await zh.text();
  const enHtml = await en.text();
  assert.match(zhHtml, /一个入口/);
  assert.match(zhHtml, /凤启世界/);
  assert.match(enHtml, /One gateway/);
  assert.match(enHtml, /Phoenix Nova world/);
  assert.match(zhHtml, /name="robots" content="noindex, nofollow, nocache"/i);
  assert.match(enHtml, /name="robots" content="noindex, nofollow, nocache"/i);
});

test("connects Digital Phoenix to the approved immortal-guardian world", async () => {
  const response = await get("/zh");
  const html = await response.text();
  assert.match(html, /数字凤启/);
  assert.match(html, /进入仙兽图/);
  assert.match(html, /\/images\/fengqi-digital-immortals\.webp/);
  assert.match(html, /https:\/\/fengqi-research-institute\.yvettfang\.chatgpt\.site/);
});

test("renders every bilingual candidate destination", async () => {
  const pages = ["compass", "lighthouse", "services", "insights", "oriental", "about", "family-center"];
  for (const locale of ["zh", "en"]) {
    for (const page of pages) {
      const response = await get(`/${locale}/${page}`);
      assert.equal(response.status, 200, `/${locale}/${page}`);
      assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
    }
  }
});

test("keeps the serial novel inside Insights", async () => {
  const insights = await get("/zh/insights");
  const home = await get("/zh");
  assert.match(await insights.text(), /《维港之上》/);
  assert.match(await home.text(), /凤启洞察/);
});
