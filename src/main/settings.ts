// User settings (settings.json in the app's user-data folder). Everything the
// setup screens send is re-validated here before it is saved.

import type { Source } from "./feeds/edition.ts";
import { plainText, safeFeedUrl } from "./feeds/sanitize.ts";
import { cleanKeywords } from "./feeds/select.ts";
import { readJsonOrSetAside, writeJsonAtomic } from "./feeds/store.ts";
import type { SourcesFile } from "./sources/schema.ts";

export const SETTINGS_SCHEMA_VERSION = 1;
export const DEFAULT_TOPICS = ["us-news", "world-news", "ai-tech"];
export const MAX_CUSTOM_SOURCES = 50;
// No limit on topics for the user (Rachel, 2026-11-08); this only bounds a damaged settings file.
export const MAX_CUSTOM_TOPICS = 100;
export const MAX_TOPIC_LABEL = 24;

export type CustomSource = { id: string; name: string; feedUrl: string; topic: string };
export type CustomTopic = { id: string; label: string }; // a topic the user named; its feeds are custom sources

export type Settings = {
  schemaVersion: typeof SETTINGS_SCHEMA_VERSION;
  onboarded: boolean;
  topics: string[];
  customTopics: CustomTopic[];
  keywords: string[];
  approvedSourceIds: string[]; // curated sources the user approved
  customSources: CustomSource[]; // feeds the user pasted (checked when added)
  editionTimes: { morning: string; evening: string }; // "HH:MM", local time
  launchAtLogin: boolean;
  popoverFilter: string; // "all" or a topic id: the popover's selected chip
  snoozeUntil: number; // ms since epoch; the cat is hidden until then (0 = not snoozed)
  paused: boolean; // he stays where he is (still visible and clickable) until resumed
  sleeping: boolean; // put to sleep from the menu bar: asleep until woken
  appearance: Appearance; // light or dark popover and setup window, or follow the Mac
};

export type Appearance = "system" | "light" | "dark";

// What a fresh install (or "skip setup") gets: default topics, but no sources,
// because nothing is fetched until the user approves sources.
export function defaultSettings(): Settings {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    onboarded: false,
    topics: [...DEFAULT_TOPICS],
    customTopics: [],
    keywords: [],
    approvedSourceIds: [],
    customSources: [],
    editionTimes: { morning: "08:00", evening: "18:00" },
    launchAtLogin: true,
    popoverFilter: "all",
    snoozeUntil: 0,
    paused: false,
    sleeping: false,
    appearance: "system",
  };
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const strings = (v: unknown, max: number): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, max) : []);

function hash(s: string): string {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h.toString(36);
}

export function customSourceId(feedUrl: string): string {
  return `custom-${hash(feedUrl)}`;
}

// A topic the user typed: plain text, one line, short. Its id comes from the
// label, so the same name always means the same topic.
export function cleanTopicLabel(raw: unknown): string {
  const s = plainText(raw, 200);
  return s.length > MAX_TOPIC_LABEL ? "" : s;
}
export function customTopicId(label: string): string {
  return `own-${hash(label.toLowerCase())}`;
}

// The user's own topics: valid labels, no duplicates, none that repeat a built-in topic.
export function cleanCustomTopics(raw: unknown, sources: SourcesFile): CustomTopic[] {
  const taken = new Set(sources.topics.map((t) => t.label.toLowerCase()));
  const out: CustomTopic[] = [];
  for (const t of Array.isArray(raw) ? raw : []) {
    if (out.length >= MAX_CUSTOM_TOPICS) break;
    const label = cleanTopicLabel(isObj(t) ? t.label : t);
    if (!label || taken.has(label.toLowerCase())) continue;
    taken.add(label.toLowerCase());
    out.push({ id: customTopicId(label), label });
  }
  return out;
}

// Built-in topics, then the user's own.
export function topicLabels(settings: Pick<Settings, "customTopics">, sources: SourcesFile): Map<string, string> {
  return new Map([...sources.topics.map((t) => [t.id, t.label] as const), ...settings.customTopics.map((t) => [t.id, t.label] as const)]);
}

// Cleans settings against the current sources file. Unknown topics and sources
// (e.g. removed from the list) are dropped; times fall back to defaults.
export function cleanSettings(raw: unknown, sources: SourcesFile): Settings {
  const d = defaultSettings();
  if (!isObj(raw)) return d;
  const customTopics = cleanCustomTopics(raw.customTopics, sources);
  const topicIds = new Set([...sources.topics.map((t) => t.id), ...customTopics.map((t) => t.id)]);
  const topics = [...new Set(strings(raw.topics, 50))].filter((t) => topicIds.has(t));
  const curated = new Map(sources.sources.map((s) => [s.id, s]));
  const approved = [...new Set(strings(raw.approvedSourceIds, 500))].filter((id) => curated.has(id));
  const custom: CustomSource[] = [];
  for (const c of Array.isArray(raw.customSources) ? raw.customSources : []) {
    if (!isObj(c) || custom.length >= MAX_CUSTOM_SOURCES) continue;
    const feedUrl = safeFeedUrl(c.feedUrl);
    const topic = typeof c.topic === "string" && topicIds.has(c.topic) ? c.topic : null;
    const name = plainText(c.name, 80);
    if (!feedUrl || !topic || !name || custom.some((x) => x.feedUrl === feedUrl)) continue;
    custom.push({ id: customSourceId(feedUrl), name, feedUrl, topic });
  }
  const times = isObj(raw.editionTimes) ? raw.editionTimes : {};
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    onboarded: raw.onboarded === true,
    topics,
    customTopics,
    keywords: cleanKeywords(strings(raw.keywords, 50)),
    approvedSourceIds: approved,
    customSources: custom,
    editionTimes: {
      morning: typeof times.morning === "string" && HHMM.test(times.morning) ? times.morning : d.editionTimes.morning,
      evening: typeof times.evening === "string" && HHMM.test(times.evening) ? times.evening : d.editionTimes.evening,
    },
    launchAtLogin: typeof raw.launchAtLogin === "boolean" ? raw.launchAtLogin : d.launchAtLogin,
    popoverFilter: typeof raw.popoverFilter === "string" && (raw.popoverFilter === "all" || topics.includes(raw.popoverFilter)) ? raw.popoverFilter : "all",
    snoozeUntil: typeof raw.snoozeUntil === "number" && Number.isFinite(raw.snoozeUntil) && raw.snoozeUntil > 0 ? raw.snoozeUntil : 0,
    paused: raw.paused === true,
    sleeping: raw.sleeping === true,
    appearance: raw.appearance === "light" || raw.appearance === "dark" ? raw.appearance : "system",
  };
}

// The feeds an edition should fetch: approved curated sources and the user's own,
// limited to the topics the user picked.
export function editionSources(settings: Settings, sources: SourcesFile): Source[] {
  const picked = new Set(settings.topics);
  const curated = sources.sources
    .filter((s) => settings.approvedSourceIds.includes(s.id) && s.topics.some((t) => picked.has(t)))
    .map((s) => ({ id: s.id, name: s.name, feedUrl: s.feedUrl, topics: s.topics, paywall: s.paywall === true }));
  const own = settings.customSources
    .filter((c) => picked.has(c.topic))
    .map((c) => ({ id: c.id, name: c.name, feedUrl: c.feedUrl, topics: [c.topic], paywall: false }));
  return [...curated, ...own];
}

export async function loadSettings(path: string, sources: SourcesFile): Promise<Settings> {
  const raw = await readJsonOrSetAside(path);
  return raw === null ? defaultSettings() : cleanSettings(raw, sources);
}

export async function saveSettings(path: string, settings: Settings): Promise<void> {
  await writeJsonAtomic(path, settings);
}
