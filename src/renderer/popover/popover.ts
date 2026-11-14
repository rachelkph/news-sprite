// The popover: the Gazette's nameplate, topic chips, the top story, headlines by
// topic, footer. Text is set with textContent only. Reports its natural height so
// main can anchor it.

import { pixelIcon } from "./icons.ts";

type ViewItem = { key: string; headline: string; source: string; alsoIn: number; paywall: boolean; stamp: string; opened: boolean; fresh: boolean };
type View = {
  nameplate: string;
  edition: string;
  dateLabel: string;
  newLabel: string | null;
  countLabel: string;
  lead: (ViewItem & { topic: string; topicLabel: string }) | null;
  chips: { id: string; label: string }[];
  filter: string;
  sections: { topic: string; label: string; items: ViewItem[]; more: ViewItem[] }[];
  fetchedLabel: string | null;
  empty: null | { title: string; body: string; action: "setup" | "refresh" | null };
  refreshing: boolean;
};

declare global {
  interface Window {
    popover: {
      view(): Promise<View>;
      open(key: string): void;
      filter(id: string): void;
      refresh(): void;
      settings(): void;
      toggleTheme(): void;
      close(): void;
      height(h: number): void;
      onShow(cb: (v: View) => void): void;
      onUpdate(cb: (v: View) => void): void;
      onLayout(cb: (l: { tailX: number; height: number }) => void): void;
    };
  }
}

const LIST_MAX = 430;
const darkScheme = window.matchMedia("(prefers-color-scheme: dark)");
const card = document.getElementById("card") as HTMLElement;
const frame = document.getElementById("frame") as HTMLElement;
const root = document.documentElement;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, ...kids: (Node | string | null)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k of kids) if (k !== null) e.append(k);
  return e;
}

function button(cls: string, label: string, onClick: () => void, ...kids: (Node | string)[]): HTMLButtonElement {
  const b = el("button", cls, ...kids);
  b.type = "button";
  if (label) b.setAttribute("aria-label", label);
  b.addEventListener("click", onClick);
  return b;
}

// Topics whose "Show more" is open; reset each time the popover opens.
const expanded = new Set<string>();
let lastView: View | null = null;

// Source line: NEW tag, source (+ other outlets), paywall; the publish time on the right.
function meta(it: ViewItem): HTMLElement {
  const source = it.alsoIn > 0 ? `${it.source} +${it.alsoIn} more` : it.source;
  return el("span", "meta", it.fresh ? el("span", "new", "new") : null, el("span", undefined, source), it.paywall ? el("span", "paywall", "paywall") : null, el("span", "stamp", it.stamp));
}

function row(it: ViewItem): HTMLButtonElement {
  const b = button(`row${it.opened ? " opened" : ""}`, "", () => window.popover.open(it.key), el("span", "headline", it.headline), meta(it));
  b.title = it.headline;
  return b;
}

function leadStory(it: NonNullable<View["lead"]>): HTMLElement {
  const b = button(`lead${it.opened ? " opened" : ""}`, "", () => window.popover.open(it.key), el("span", "kicker", `Top story · ${it.topicLabel}`), el("span", "headline", it.headline), meta(it));
  b.title = it.headline;
  return b;
}

function render(v: View): void {
  lastView = v;
  const counts = el("span");
  if (v.newLabel) counts.append(el("span", "n", v.newLabel), " · ");
  counts.append(v.countLabel);
  const folio = el("div", "folio", el("div", "rule2"), el("div", "folio-line", el("span", undefined, `${v.edition} · ${v.dateLabel}`), counts), el("div", "rule1"));
  const header = el("header", undefined, el("h1", "masthead", v.nameplate), folio);
  (header.firstChild as HTMLElement).id = "masthead";
  (header.firstChild as HTMLElement).tabIndex = -1;

  if (!v.empty) {
    const chips = el("div", "chips");
    chips.setAttribute("role", "group");
    chips.setAttribute("aria-label", "Show topic");
    for (const c of v.chips) {
      const b = button("chip", "", () => window.popover.filter(c.id), ...(c.id === "all" ? [] : [pixelIcon(c.id)]), c.label);
      b.setAttribute("aria-pressed", String(v.filter === c.id));
      chips.append(b);
    }
    header.append(chips);
  }

  const list = el("div", "list");
  if (v.empty) {
    const box = el("div", "empty", el("div", "title", v.empty.title), el("div", "body", v.empty.body));
    if (v.empty.action === "setup") box.append(button("btn", "", () => window.popover.settings(), "Choose sources"));
    list.append(box);
  } else if (v.sections.length === 0) {
    const label = v.chips.find((c) => c.id === v.filter)?.label ?? "this topic";
    list.append(el("div", "empty", el("div", "body", `Nothing in ${label} right now.`)));
  } else {
    if (v.lead) list.append(leadStory(v.lead));
    v.sections.forEach((s) => {
      const head = el("h2", "section-head", pixelIcon(s.topic), s.label);
      list.append(head);
      for (const it of s.items) list.append(row(it));
      if (s.more.length > 0) {
        const open = expanded.has(s.topic);
        if (open) for (const it of s.more) list.append(row(it));
        const toggle = button("more", "", () => {
          if (open) expanded.delete(s.topic);
          else expanded.add(s.topic);
          if (lastView) render(lastView);
        }, open ? "Show fewer" : `Show ${s.more.length} more`);
        toggle.setAttribute("aria-expanded", String(open));
        list.append(toggle);
      }
    });
  }

  const refresh = button("btn", "", () => window.popover.refresh(), pixelIcon("refresh"), v.refreshing ? "Refreshing…" : "Refresh");
  refresh.disabled = v.refreshing;
  // Light/dark: the button shows what it switches to.
  const dark = darkScheme.matches;
  const theme = button("btn", dark ? "Switch to light" : "Switch to dark", () => window.popover.toggleTheme(), pixelIcon(dark ? "sun" : "moon"));
  theme.title = dark ? "Light" : "Dark";
  const footer = el("footer", undefined, el("span", "fetched", v.fetchedLabel ?? ""), refresh, button("btn", "", () => window.popover.settings(), pixelIcon("settings"), "Settings"), theme);

  const scroll = card.querySelector(".list")?.scrollTop ?? 0;
  card.replaceChildren(header, list, footer);
  list.scrollTop = scroll;
  root.style.setProperty("--list-max", `${LIST_MAX}px`);
  fitNameplate();
  reportHeight();
}

// The nameplate stays on one line: long names step the pixel font down (24 -> 14 px).
function fitNameplate(): void {
  const h1 = card.querySelector<HTMLElement>(".masthead");
  const header = h1?.parentElement;
  if (!h1 || !header) return;
  const cs = getComputedStyle(header);
  const room = header.clientWidth - Number.parseFloat(cs.paddingLeft) - Number.parseFloat(cs.paddingRight);
  let size = 24;
  h1.style.fontSize = `${size}px`;
  while (size > 14 && h1.scrollWidth > room) h1.style.fontSize = `${--size}px`;
}

// Measured synchronously (reading the size forces layout): a hidden page gets no
// animation frames, so a requestAnimationFrame here would never reopen the popover.
function reportHeight(): void {
  window.popover.height(frame.getBoundingClientRect().height);
}
// Refit once the pixel font has actually loaded: the first render measures with a
// fallback font, and fonts.ready can settle before the nameplate's font starts loading.
document.fonts.addEventListener("loadingdone", () => {
  fitNameplate();
  reportHeight();
});
void document.fonts.ready.then(() => {
  fitNameplate();
  reportHeight();
});

window.popover.onShow((v) => {
  expanded.clear();
  render(v);
  (card.querySelector(".list") as HTMLElement | null)?.scrollTo(0, 0);
});
// Keyboard and screen-reader users start at the masthead once the window is shown and focused.
window.addEventListener("focus", () => {
  if (document.activeElement === document.body || document.activeElement === null) (document.getElementById("masthead") as HTMLElement | null)?.focus();
});
window.popover.onUpdate((v) => render(v));
// The theme changed (from this button, the menu bar, or the Mac): redraw the button.
darkScheme.addEventListener("change", () => {
  if (lastView) render(lastView);
});
window.popover.onLayout(({ tailX, height }) => {
  root.style.setProperty("--tail-x", `${tailX}px`);
  // If the screen is too short, shrink the list so the whole popover fits.
  const natural = frame.getBoundingClientRect().height;
  if (height < natural) {
    const list = card.querySelector(".list") as HTMLElement | null;
    if (list) root.style.setProperty("--list-max", `${Math.max(80, list.getBoundingClientRect().height - (natural - height))}px`);
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") window.popover.close();
});

// Initial content so the first show is instant.
render(await window.popover.view());
