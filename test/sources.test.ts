import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { Deps } from "../src/main/feeds/client.ts";
import { applyFinish, applySkip, buildModel } from "../src/main/onboarding/model.ts";
import { emptyState } from "../src/main/feeds/store.ts";
import { buildView } from "../src/main/popover/view.ts";
import { cleanSettings, customTopicId, defaultSettings, editionSources, loadSettings, MAX_CUSTOM_TOPICS, topicLabels } from "../src/main/settings.ts";
import { COMMON_FEED_PATHS, checkLink, feedLinks, NO_FEED_MESSAGE, normalizeInput } from "../src/main/sources/discover.ts";
import { loadSources, REMOTE_CHECK_MS } from "../src/main/sources/load.ts";
import { parseSourcesFile, type SourcesFile } from "../src/main/sources/schema.ts";

const BUNDLED = join(import.meta.dirname, "..", "data", "sources.json");
const raw = () => JSON.parse(readFileSync(BUNDLED, "utf8"));
const file: SourcesFile = parseSourcesFile(raw());
const T = Date.parse("2026-11-08T18:00:00Z");
const RSS = `<rss><channel><title>Pasted Blog</title><item><title>Older post</title><link>https://blog.example.com/1</link><pubDate>Sat, 07 Nov 2026 10:00:00 GMT</pubDate></item><item><title>Newest post</title><link>https://blog.example.com/2</link><pubDate>Sun, 08 Nov 2026 10:00:00 GMT</pubDate></item></channel></rss>`;

function fake(routes: Record<string, () => Response>, opts: { private?: string[] } = {}) {
  let now = T;
  const calls: string[] = [];
  const deps: Deps = {
    now: () => now,
    sleep: async () => {},
    lookup: async (h) => ((opts.private ?? []).includes(h) ? ["10.0.0.7"] : ["93.184.216.34"]),
    fetch: (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      const r = routes[url];
      if (!r) throw new TypeError("fetch failed");
      return r();
    }) as typeof fetch,
  };
  return { deps, calls, advance: (ms: number) => (now += ms) };
}

describe("sources schema", () => {
  it("accepts the bundled list, and its recommended sources follow the rules", () => {
    assert.equal(file.sources.length, 65);
    assert.ok(!file.sources.some((s) => s.paywall === true), "no paywalled sources (Rachel, 2026-11-13)");
    // No built-in topic is left without recommended sources (Rachel, 2026-11-11).
    for (const t of file.topics) {
      const n = file.sources.filter((x) => x.recommendedDefault && x.topics.includes(t.id)).length;
      assert.ok(n >= 1, `${t.id} has no recommended sources`);
    }
    const world = file.sources.filter((x) => x.recommendedDefault && x.topics.includes("world-news")).map((x) => x.id);
    assert.deepEqual(world, ["bbc-news-world", "npr-world", "guardian-world"], "world news: BBC, NPR and The Guardian");
    for (const s of file.sources.filter((x) => x.recommendedDefault)) {
      assert.notEqual(s.paywall, true, s.id);
      assert.ok(!s.userOptInOnly && !s.unofficialFeed, s.id);
      assert.ok(s.feedUrl.startsWith("https://"), s.id);
    }
  });

  const broken: [string, (d: ReturnType<typeof raw>) => void, RegExp][] = [
    ["wrong schema version", (d) => { d.schemaVersion = 2; }, /schemaVersion/],
    ["paywalled source recommended", (d) => { d.sources.find((s: { id: string }) => s.id === "bbc-news-world").paywall = true; }, /recommended by default but is paywalled/],
    ["unofficial source recommended", (d) => { d.sources.find((s: { id: string }) => s.id === "reuters-google-news").recommendedDefault = true; }, /unofficial/],
    ["unknown topic", (d) => { d.sources[0].topics = ["cooking"]; }, /unknown topic "cooking"/],
    ["duplicate id", (d) => { d.sources[1].id = d.sources[0].id; }, /duplicates/],
    ["javascript feed URL", (d) => { d.sources[0].feedUrl = "javascript:alert(1)"; }, /feedUrl/],
    ["local feed URL", (d) => { d.sources[0].feedUrl = "http://localhost:8080/rss"; }, /feedUrl/],
    ["bad rating evidence URL", (d) => { d.sources[0].ratings[0].evidenceUrl = "file:///etc/passwd"; }, /evidenceUrl/],
    ["missing name", (d) => { d.sources[0].name = "   "; }, /name/],
    ["too-long description", (d) => { d.sources[0].description = "x".repeat(400); }, /description/],
    ["bad paywall value", (d) => { d.sources[0].paywall = "maybe"; }, /paywall/],
  ];
  for (const [name, mutate, err] of broken) {
    it(`rejects: ${name}`, () => {
      const d = raw();
      mutate(d);
      assert.throws(() => parseSourcesFile(d), err);
    });
  }

  it("strips HTML from names", () => {
    const d = raw();
    d.sources[0].name = "<b>BBC</b> World";
    assert.equal(parseSourcesFile(d).sources[0].name, "BBC World");
  });
});

describe("loadSources", () => {
  const URL_ = "https://raw.example.com/sources.json";
  const newer = () => JSON.stringify({ ...raw(), lastReviewed: "2026-12-01" });

  it("uses a newer valid remote copy, then caches it for a day", async () => {
    const { deps, calls, advance } = fake({ [URL_]: () => new Response(newer(), { status: 200, headers: { etag: '"r1"' } }) });
    const first = await loadSources({ bundledPath: BUNDLED, remoteUrl: URL_, remote: undefined, deps, allowNetwork: true });
    assert.equal(first.origin, "remote");
    assert.equal(first.file.lastReviewed, "2026-12-01");
    const again = await loadSources({ bundledPath: BUNDLED, remoteUrl: URL_, remote: first.remote, deps, allowNetwork: true });
    assert.equal(again.origin, "remote");
    assert.equal(calls.length, 1, "no second request within a day");
    advance(REMOTE_CHECK_MS);
    await loadSources({ bundledPath: BUNDLED, remoteUrl: URL_, remote: first.remote, deps, allowNetwork: true });
    assert.equal(calls.length, 2);
  });

  it("falls back to the bundled copy when the remote copy is broken", async () => {
    const bad = raw();
    bad.lastReviewed = "2026-12-01";
    bad.sources[0].feedUrl = "javascript:alert(1)";
    for (const body of [JSON.stringify(bad), "<html>not json</html>"]) {
      const { deps } = fake({ [URL_]: () => new Response(body, { status: 200 }) });
      const out = await loadSources({ bundledPath: BUNDLED, remoteUrl: URL_, remote: undefined, deps, allowNetwork: true });
      assert.equal(out.origin, "bundled");
      assert.ok(out.note, "explains why");
    }
  });

  it("keeps the last good remote copy when the network fails", async () => {
    const ok = fake({ [URL_]: () => new Response(newer(), { status: 200 }) });
    const first = await loadSources({ bundledPath: BUNDLED, remoteUrl: URL_, remote: undefined, deps: ok.deps, allowNetwork: true });
    const down = fake({});
    down.advance(REMOTE_CHECK_MS);
    const out = await loadSources({ bundledPath: BUNDLED, remoteUrl: URL_, remote: first.remote, deps: down.deps, allowNetwork: true });
    assert.equal(out.origin, "remote");
    assert.match(out.remote.lastError ?? "", /network/);
  });

  it("ignores an older remote copy, a 404, and makes no request when off", async () => {
    const older = fake({ [URL_]: () => new Response(JSON.stringify({ ...raw(), lastReviewed: "2026-01-01" }), { status: 200 }) });
    assert.equal((await loadSources({ bundledPath: BUNDLED, remoteUrl: URL_, remote: undefined, deps: older.deps, allowNetwork: true })).origin, "bundled");
    const missing = fake({ [URL_]: () => new Response("", { status: 404 }) });
    assert.equal((await loadSources({ bundledPath: BUNDLED, remoteUrl: URL_, remote: undefined, deps: missing.deps, allowNetwork: true })).origin, "bundled");
    const off = fake({});
    await loadSources({ bundledPath: BUNDLED, remoteUrl: "", remote: undefined, deps: off.deps, allowNetwork: true });
    await loadSources({ bundledPath: BUNDLED, remoteUrl: URL_, remote: undefined, deps: off.deps, allowNetwork: false });
    assert.equal(off.calls.length, 0);
  });
});

describe("checkLink (pasted links)", () => {
  it("validates a feed and shows its newest headline", async () => {
    const { deps } = fake({ "https://blog.example.com/feed.xml": () => new Response(RSS, { status: 200, headers: { "content-type": "application/rss+xml" } }) });
    assert.deepEqual(await checkLink("https://blog.example.com/feed.xml", deps), {
      kind: "feed",
      feedUrl: "https://blog.example.com/feed.xml",
      title: "Pasted Blog",
      latestHeadline: "Newest post",
      discovered: false,
    });
  });

  it("discovers a site's advertised feed", async () => {
    const page = `<!doctype html><html><head><link rel="stylesheet" href="/s.css"><link rel="alternate" type="application/rss+xml" title="Blog" href="/feed.xml"></head><body>hello</body></html>`;
    const { deps } = fake({
      "https://blog.example.com/": () => new Response(page, { status: 200, headers: { "content-type": "text/html" } }),
      "https://blog.example.com/feed.xml": () => new Response(RSS, { status: 200 }),
    });
    const out = await checkLink("blog.example.com", deps);
    assert.equal(out.kind, "feed");
    assert.equal(out.kind === "feed" && out.discovered, true);
    assert.equal(out.kind === "feed" && out.feedUrl, "https://blog.example.com/feed.xml");
  });

  it("says so when a site has no feed (no scraping)", async () => {
    const { deps, calls } = fake({ "https://plain.example.com/": () => new Response("<html><head><title>x</title></head><body><a href='/rss'>rss</a></body></html>", { status: 200, headers: { "content-type": "text/html" } }) });
    assert.deepEqual(await checkLink("https://plain.example.com/", deps), { kind: "none", message: NO_FEED_MESSAGE });
    assert.deepEqual(calls, ["https://plain.example.com/", ...COMMON_FEED_PATHS.map((p) => `https://plain.example.com${p}`)], "only the usual feed addresses; did not follow links in the page body");
  });

  it("tries the usual feed addresses when a page advertises none", async () => {
    const { deps, calls } = fake({
      "https://news.example.com/": () => new Response("<html><head><title>x</title></head><body></body></html>", { status: 200, headers: { "content-type": "text/html" } }),
      "https://news.example.com/feed/": () => new Response("<html>soft 404</html>", { status: 200, headers: { "content-type": "text/html" } }),
      "https://news.example.com/rss/index.xml": () => new Response(RSS, { status: 200 }),
    });
    const out = await checkLink("news.example.com", deps);
    assert.equal(out.kind === "feed" && out.feedUrl, "https://news.example.com/rss/index.xml");
    assert.equal(calls.length, 3, "stops at the first feed");
  });

  it("rejects local, private and non-web addresses", async () => {
    const { deps, calls } = fake({}, { private: ["sneaky.example.com"] });
    for (const bad of ["http://localhost:3000/feed", "http://192.168.1.10/rss", "file:///etc/passwd", "javascript:alert(1)", "printer.local", "not a url", ""]) {
      assert.equal((await checkLink(bad, deps)).kind, "invalid", bad);
    }
    assert.equal((await checkLink("https://sneaky.example.com/feed", deps)).kind, "invalid", "DNS points to a private address");
    assert.equal(calls.length, 0, "never connected");
  });

  it("reports unreachable sites without crashing", async () => {
    const { deps } = fake({});
    const out = await checkLink("https://down.example.com/feed", deps);
    assert.equal(out.kind, "none");
  });

  it("finds a feed link deep in a large <head>, and ignores ones inside scripts", () => {
    const filler = `<style>${".a{color:red}".repeat(30_000)}</style>`; // ~360 KB
    const html = `<!doctype html><html><head>${filler}<script>var s='<link rel="alternate" type="application/rss+xml" href="/fake.xml">';</script><link rel="alternate" type="application/rss+xml" href="/feed/rss/" /></head><body></body></html>`;
    assert.ok(html.indexOf("/feed/rss/") > 300_000);
    assert.deepEqual(feedLinks(html, "https://site.example.com/"), ["https://site.example.com/feed/rss/"]);
  });

  it("parses feed link tags in any attribute order and quoting", () => {
    const html = `<link href='/a.xml' type='application/atom+xml' rel='alternate'><link rel=alternate type=application/rss+xml href=https://cdn.example.com/b.rss><link rel="alternate" type="text/html" href="/c">`;
    assert.deepEqual(feedLinks(html, "https://site.example.com/blog/"), ["https://site.example.com/a.xml", "https://cdn.example.com/b.rss"]);
    assert.equal(normalizeInput("example.com/feed"), "https://example.com/feed");
  });
});

describe("settings and setup", () => {
  it("a fresh install has default topics and no sources (nothing fetched without approval)", () => {
    const d = defaultSettings();
    assert.deepEqual(d.topics, ["us-news", "world-news", "ai-tech"]);
    assert.equal(editionSources(d, file).length, 0);
    assert.equal(editionSources(applySkip(d), file).length, 0);
    assert.equal(applySkip(d).onboarded, true);
  });

  it("approving recommended sources makes them the edition's sources, limited to picked topics", () => {
    const model = buildModel(file, defaultSettings());
    const recommended = model.sources.filter((s) => s.recommended && s.topics.some((t) => model.defaultTopics.includes(t))).map((s) => s.id);
    const s = applyFinish({ topics: model.defaultTopics, approvedSourceIds: [...recommended, "variety"], keywords: "synth, , open source" }, file, defaultSettings(), new Map());
    assert.ok(!s.approvedSourceIds.includes("variety"), "film-tv not picked");
    assert.deepEqual(editionSources(s, file).map((x) => x.id).sort(), recommended.sort());
    assert.deepEqual(s.keywords, ["synth", "open source"]);
    assert.ok(model.topics.every((t) => t.recommendedCount >= 1), "no topic without recommended sources");
  });

  it("only accepts pasted feeds that were verified this session", () => {
    const verified = new Map([["https://blog.example.com/feed.xml", { title: "Pasted Blog" }]]);
    const s = applyFinish(
      {
        topics: ["music"],
        customSources: [
          { feedUrl: "https://blog.example.com/feed.xml", topic: "music" },
          { feedUrl: "https://unchecked.example.com/rss", topic: "music" },
          { feedUrl: "https://blog.example.com/feed.xml", topic: "not-a-topic" },
        ],
        editionTimes: { morning: "07:30", evening: "25:00" },
      },
      file,
      defaultSettings(),
      verified,
    );
    assert.deepEqual(s.customSources.map((c) => [c.name, c.topic]), [["Pasted Blog", "music"]]);
    assert.deepEqual(s.editionTimes, { morning: "07:30", evening: "18:00" });
    assert.deepEqual(s.topics, ["music"]);
  });

  it("your own topic: named in setup, fed by a pasted feed, shown with its full name", () => {
    const verified = new Map([["https://f1.example.com/feed.xml", { title: "F1 Blog" }]]);
    const s = applyFinish(
      {
        topics: ["us-news", "new:formula 1", "new:knitting"],
        customTopics: [
          { key: "new:formula 1", label: "  Formula   1 " },
          { key: "new:knitting", label: "Knitting" },
          { key: "new:gone", label: "Not picked" },
          { key: "new:science", label: "science" }, // repeats a built-in: refused
          { key: "new:long", label: "x".repeat(25) },
        ],
        customSources: [
          { feedUrl: "https://f1.example.com/feed.xml", topic: "new:formula 1" },
          { feedUrl: "https://f1.example.com/feed.xml", topic: "new:gone" },
        ],
      },
      file,
      defaultSettings(),
      verified,
    );
    const f1 = customTopicId("Formula 1");
    assert.deepEqual(s.customTopics, [
      { id: f1, label: "Formula 1" },
      { id: customTopicId("Knitting"), label: "Knitting" },
    ]);
    assert.deepEqual(s.topics, ["us-news", f1, customTopicId("Knitting")]);
    assert.deepEqual(s.customSources.map((c) => [c.name, c.topic]), [["F1 Blog", f1]]);
    assert.deepEqual(editionSources(s, file).map((x) => x.topics), [[f1]]);
    assert.equal(customTopicId("formula 1"), f1, "same name, same topic");

    // Survives a save and reload, and re-running setup keeps it under the same id.
    const reloaded = cleanSettings(JSON.parse(JSON.stringify(s)), file);
    assert.deepEqual(reloaded.customTopics, s.customTopics);
    assert.deepEqual(reloaded.customSources, s.customSources);
    const model = buildModel(file, reloaded);
    const again = applyFinish({ topics: model.settings.topics, customTopics: model.settings.customTopics.map((t) => ({ key: t.id, label: t.label })), customSources: model.settings.customSources }, file, reloaded, new Map());
    assert.deepEqual(again.customSources, s.customSources);

    // Unpicking it forgets the topic and its feeds.
    const dropped = applyFinish({ topics: ["us-news"], customTopics: [{ key: f1, label: "Formula 1" }], customSources: [{ feedUrl: "https://f1.example.com/feed.xml", topic: f1 }] }, file, reloaded, new Map());
    assert.deepEqual(dropped.customTopics, []);
    assert.deepEqual(dropped.customSources, []);

    // The popover: its own section and a chip with the full name.
    const labels = topicLabels(s, file);
    const item = { headline: "Grand Prix result", link: "https://f1.example.com/1", publishedAt: T - 3600_000, source: "F1 Blog", sourceId: "x", topic: f1, paywall: false, addedAt: T - 60_000 };
    const state = { ...emptyState(), editions: [{ id: "e", slot: "evening" as const, scheduledFor: T - 600_000, fetchedAt: T - 60_000, items: [item] }] };
    const view = buildView(state, { now: T, topics: s.topics.map((id) => ({ id, label: labels.get(id) ?? id })), sources: editionSources(s, file), keywords: [], filter: "all", editionTimes: s.editionTimes, hasSources: true, refreshing: false, clock: () => "6 PM" });
    assert.equal(view.lead?.topicLabel, "Formula 1", "its only story leads the front page");
    assert.ok(view.chips.some((c) => c.id === f1 && c.label === "Formula 1"));
  });

  it("cleans tampered custom topics", () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ label: `Topic ${i}` }));
    const s = cleanSettings({ customTopics: [{ label: "<b>Chess</b>" }, { label: "chess" }, { label: "\u202eevil" }, { label: "" }, 42, ...many], topics: [customTopicId("Chess"), "own-forged"] }, file);
    assert.equal(s.customTopics[0].label, "Chess");
    assert.equal(s.customTopics.filter((t) => t.label.toLowerCase() === "chess").length, 1);
    assert.ok(s.customTopics.every((t) => !/[\u202e<>]/.test(t.label) && t.label.length > 0));
    assert.ok(s.customTopics.length <= MAX_CUSTOM_TOPICS);
    assert.deepEqual(s.topics, [customTopicId("Chess")], "unknown topic ids dropped");
  });

  it("cleans a tampered settings file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "newscat-settings-"));
    const path = join(dir, "settings.json");
    await writeFile(path, JSON.stringify({ onboarded: true, topics: ["us-news", "hacking"], approvedSourceIds: ["npr-news", "evil"], customSources: [{ name: "x", feedUrl: "http://127.0.0.1/rss", topic: "us-news" }], editionTimes: { morning: "nope" } }));
    const s = await loadSettings(path, file);
    assert.deepEqual(s.topics, ["us-news"]);
    assert.deepEqual(s.approvedSourceIds, ["npr-news"]);
    assert.deepEqual(s.customSources, []);
    assert.equal(s.editionTimes.morning, "08:00");
    assert.equal(cleanSettings("garbage", file).onboarded, false);
  });

  it("remembers that he is paused; anything but true is not paused; setup keeps it", () => {
    assert.equal(defaultSettings().paused, false);
    assert.equal(cleanSettings({ paused: true }, file).paused, true);
    assert.equal(cleanSettings({ paused: "yes" }, file).paused, false);
    const prev = { ...defaultSettings(), paused: true };
    assert.equal(applySkip(prev).paused, true, "skipping setup");
    assert.equal(applyFinish({ topics: ["music"], approvedSourceIds: [] }, file, prev, new Map()).paused, true, "finishing setup");
  });

  it("remembers light or dark (else follows the Mac), through setup too", () => {
    assert.equal(defaultSettings().appearance, "system");
    assert.equal(cleanSettings({ appearance: "dark" }, file).appearance, "dark");
    assert.equal(cleanSettings({ appearance: "light" }, file).appearance, "light");
    assert.equal(cleanSettings({ appearance: "purple" }, file).appearance, "system");
    const prev = { ...defaultSettings(), appearance: "dark" as const };
    assert.equal(applySkip(prev).appearance, "dark");
    assert.equal(applyFinish({ topics: ["music"], approvedSourceIds: [] }, file, prev, new Map()).appearance, "dark");
  });

  it("remembers that he was put to sleep, through setup too", () => {
    assert.equal(defaultSettings().sleeping, false);
    assert.equal(cleanSettings({ sleeping: true }, file).sleeping, true);
    assert.equal(cleanSettings({ sleeping: 1 }, file).sleeping, false);
    const prev = { ...defaultSettings(), sleeping: true };
    assert.equal(applySkip(prev).sleeping, true);
    assert.equal(applyFinish({ topics: ["music"], approvedSourceIds: [] }, file, prev, new Map()).sleeping, true);
  });
});
