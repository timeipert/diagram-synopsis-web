(function(){let e=document.createElement(`link`).relList;if(e&&e.supports&&e.supports(`modulepreload`))return;for(let e of document.querySelectorAll(`link[rel="modulepreload"]`))n(e);new MutationObserver(e=>{for(let t of e)if(t.type===`childList`)for(let e of t.addedNodes)e.tagName===`LINK`&&e.rel===`modulepreload`&&n(e)}).observe(document,{childList:!0,subtree:!0});function t(e){let t={};return e.integrity&&(t.integrity=e.integrity),e.referrerPolicy&&(t.referrerPolicy=e.referrerPolicy),t.credentials=e.crossOrigin===`use-credentials`?`include`:e.crossOrigin===`anonymous`?`omit`:`same-origin`,t}function n(e){if(e.ep)return;e.ep=!0;let n=t(e);fetch(e.href,n)}})();var e=`"use strict";
/* Diagram synopsis front end (docs/diagram-synopsis-plan.md). Loaded after app.js; uses its helpers
   ($, view, api, esc, guard, route, routes, parseHash).

   Pages (the address after "#/synopsis"):
     (nothing)                start page
     /manuscripts[?edit=ID]   manuscript table: tick, edit, add
     /manuscript?id=ID        the diagrams of one manuscript in the order of the work: hide, edit, add, delete
     /view?locus=C.2&...      synopsis: the diagrams of chosen loci or manuscripts side by side (the locus strip chooses the loci)
     /overview                manuscripts (rows) by loci (columns): which schema, absent, or not checked
     /tags                    the tags (chapter content, diagram content, graphical elements): rename, delete
     /item?id=ID              one diagram on a page of its own (for a second window)
   A filter with several values repeats its parameter (locus=C.2&locus=C.5).

   Layout of this file: 1 helpers, 2 filter drop-downs, 3 diagram card (shared by both diagram pages),
   4 dialogs, 5 the pages. */

const SYN_NONE = "_none";   // value of the schema and level filters for "no value"
const SYN_FILTERS = ["locus", "siglum", "century", "origin", "schema", "level", "hand", "tag", "source"];
const PICKS = SYN_FILTERS.filter(k => k !== "locus");   // drop-downs of the synopsis
const MAIN_PICKS = ["locus", "siglum", "century", "origin", "schema"];   // the five filters of the researcher's mock-up
const MORE_PICKS = PICKS.filter(k => !MAIN_PICKS.includes(k));
const OV_FILTERS = ["locus", "siglum", "century", "origin"];
const MS_FILTERS = ["book", "chapter", "locus"];   // the filters of the one-manuscript view

routes.synopsis = (arg, params) => (clearSelection(), arg === "view" ? synopsisView(params) : arg === "manuscripts" ? synopsisManuscripts(params)
    : arg === "manuscript" ? synopsisManuscript(params) : arg === "overview" ? synopsisOverview(params)
    : arg === "select" ? synopsisSelect() : arg === "search" ? synopsisSearch() : arg === "history" ? synopsisHistory() : arg === "stats" ? synopsisStats()
    : arg === "tags" ? synopsisTags() : arg === "item" ? synopsisItemPage(params) : synopsisStart());

/* The header of the page and the bar of filters stay in view while the diagrams scroll: their heights are CSS variables, so that
   the bar sticks below the header and the headings of the loci stick below the bar. */
let stickyObserver = null;
function trackStickyHeights() {
  const root = document.documentElement, header = document.querySelector("header"), head = document.querySelector(".syn-head");
  const set = () => { root.style.setProperty("--header-h", (header ? header.offsetHeight : 0) + "px"); root.style.setProperty("--head-h", (head ? head.offsetHeight : 0) + "px"); };
  if (stickyObserver) stickyObserver.disconnect();
  stickyObserver = new ResizeObserver(set);
  if (header) stickyObserver.observe(header);
  if (head) stickyObserver.observe(head);
  set();
}

/* The names of the tag categories come from the server in English; the pages show them in German. */
const TAG_CATEGORIES_EN = { chapter: "Chapter content", diagram: "Diagram content", graphic: "Graphical elements" };
const TAG_CATEGORIES_DE = { chapter: "Kapitelinhalt", diagram: "Diagramminhalt", graphic: "Grafische Elemente" };
const apiEnglish = api;
api = async (path, options) => {
  const r = await apiEnglish(path, options);
  for (const key of ["tag_categories", "categories"]) if (r && r[key]) {
    const names = { ...r[key] };
    for (const [k, en] of Object.entries(TAG_CATEGORIES_EN)) if (names[k] === en) names[k] = TAG_CATEGORIES_DE[k];   // a category renamed by the researcher keeps her name
    r[key] = names;
  }
  return r;
};

/* ------------------------------------------------------------------ 1 helpers */
const friedlein = l => l && l.friedlein_page ? \`Friedlein S. \${l.friedlein_page}\${l.friedlein_line ? ", Z. " + l.friedlein_line : ""}\` : "";
const locusLine = l => [l.book ? \`Buch \${l.book}\` : "", l.chapter ? \`Kapitel \${l.chapter}\` : "", friedlein(l)].filter(Boolean).join(" · ");
const flash = el => { const s = el && el.querySelector(".saved"); if (!s) return; s.hidden = false; clearTimeout(s.t); s.t = setTimeout(() => s.hidden = true, 1200); };

/* The links at the top of every synopsis page. The program of its own (synopsis.html) has them in its header and only
   marks the current one; the front end of the workbench gets a row below its menu. */
const synNav = current => document.body.classList.contains("synopsis-app")
  ? (document.querySelectorAll("header nav a[data-syn]").forEach(a => a.classList.toggle("active", a.dataset.syn === current)), "")
  : \`<nav class="syn-nav">\${[["", "Start"], ["manuscripts", "Handschriften"], ["select", "Item-Auswahl"], ["view", "Synopse"], ["overview", "Überblick"], ["stats", "Statistik"], ["history", "Verlauf"], ["tags", "Tags"]]
  .map(([page, label]) => \`<a href="#/synopsis\${page ? "/" + page : ""}" class="\${page === current ? "active" : ""}">\${label}</a>\`).join("")}</nav>\`;

function synHash(page, f, extra = {}, keys = SYN_FILTERS) {
  const p = new URLSearchParams();
  for (const k of keys) (f[k] || []).forEach(v => p.append(k, v));
  if (f.q) p.set("q", f.q);
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
  return \`#/synopsis/\${page}\${p.toString() ? "?" + p.toString() : ""}\`;
}
const readFilters = (params, keys) => Object.fromEntries(keys.map(k => [k, params.getAll(k)]));

/* ------------------------------------------------------------------ 2 filter drop-downs */
/* A drop-down with check boxes; several values can be ticked. \`options\`: [{value, label, count?}]. */
function pickHtml(key, label, options, selected) {
  return \`<details class="pick" data-key="\${key}"><summary>\${esc(label)}\${selected.length ? \` <span class="pick-n">\${selected.length}</span>\` : ""}</summary>
    <div class="pick-list">\${options.map(o => \`<label><input type="checkbox" value="\${esc(o.value)}" \${selected.includes(String(o.value)) ? "checked" : ""}> \${esc(o.label)}\${o.count != null ? \` <small class="muted">\${o.count}</small>\` : ""}</label>\`).join("") || '<span class="muted small">nichts zur Auswahl</span>'}
    \${selected.length ? '<button class="link pick-clear">clear</button>' : ""}</div></details>\`;
}
document.addEventListener("click", e => {   // a drop-down closes when the click is outside it
  document.querySelectorAll("details.pick[open]").forEach(d => { if (!d.contains(e.target)) d.open = false; });
});
/* Reads the ticked values into \`f[key]\` and calls \`changed(key)\`, which redraws the bar; the drop-down stays open while ticking. */
function bindPicks(bar, f, changed) {
  bar.onchange = e => {
    const pick = e.target.closest("details.pick"); if (!pick) return;
    const key = pick.dataset.key;
    f[key] = [...pick.querySelectorAll("input:checked")].map(i => i.value);
    changed(key);
    const again = bar.querySelector(\`details.pick[data-key="\${key}"]\`); if (again) again.open = true;
  };
  bar.onclick = e => {
    if (!e.target.classList.contains("pick-clear")) return;
    const key = e.target.closest("details.pick").dataset.key; f[key] = []; changed(key);
  };
}

/* The loci in the order of the work, grouped by chapter. The chapter label stands for all loci of the chapter.
   o.link: chips are links to the synopsis (start page); otherwise buttons that toggle \`selected\` (see bindStrip).
   o.counts: code -> number on the chip (default: the number of diagrams at the locus). */
function locusStrip(loci, selected, o = {}) {
  const groups = [];
  for (const l of loci) {
    const key = \`\${l.book}|\${l.chapter ?? 0}\`;
    let g = groups.find(x => x.key === key);
    if (!g) groups.push(g = { key, book: l.book, chapter: l.chapter, loci: [] });
    g.loci.push(l);
  }
  const multiBook = new Set(loci.map(l => l.book)).size > 1;
  const count = l => o.counts ? o.counts[l.code] : l.item_count;
  const chip = l => {
    const on = selected.includes(l.code) ? "on" : "", title = esc(locusLine(l));
    return o.link ? \`<a class="chip filter \${on}" href="\${synHash("view", { locus: [l.code] })}" title="\${title}">\${esc(l.code)} <small>\${count(l)}</small></a>\`
      : \`<button class="chip filter \${on}" data-locus="\${esc(l.code)}" title="\${title}">\${esc(l.code)} <small>\${count(l)}</small></button>\`;
  };
  return \`<div class="locus-strip">\${groups.map(g => {
    const label = g.chapter ? \`\${multiBook ? g.book + " " : ""}chapter \${g.chapter}\` : \`book \${g.book}\`;
    const codes = g.loci.map(l => l.code);
    const head = o.link ? \`<a class="strip-label" href="\${synHash("view", { locus: codes })}" title="All loci of this chapter">\${label}</a>\`
      : \`<button class="strip-label" data-chapter="\${esc(codes.join(","))}" title="All loci of this chapter">\${label}</button>\`;
    return \`<div class="strip-group">\${head}\${g.loci.map(chip).join("")}</div>\`;
  }).join("")}</div>\`;
}
const toggled = (list, values) => values.every(v => list.includes(v)) ? list.filter(v => !values.includes(v)) : [...new Set([...list, ...values])];
/* Clicks on the chips, the chapter labels and the "all" chip of a toggling strip; \`changed(selection)\` gets the new selection. */
function bindStrip(el, getSelected, changed) {
  el.onclick = e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.hasAttribute("data-all")) changed([]);
    else if (b.dataset.locus) changed(toggled(getSelected(), [b.dataset.locus]));
    else if (b.dataset.chapter) changed(toggled(getSelected(), b.dataset.chapter.split(",")));
  };
}

/* How the diagrams are laid out: "same height" (every image as high as the slider says) or "equal boxes" (a grid with the number
   of columns the slider says, every image fitted into a box of the same size, which makes versions easy to compare). */
const layoutHtml = () => \`<label title="Wie die Diagramme angeordnet werden">Anordnung <select id="layout"><option value="hover">nur Bilder, Angaben beim Darüberfahren</option><option value="compact">kompakt (Text unter dem Bild)</option><option value="height">Bild und Text nebeneinander</option><option value="grid">gleich große Felder</option></select></label>
  <label><span id="size-label"></span> <input type="range" id="h"></label>\`;
/* The default arrangement depends on the window: "compact" (text under the image) fits several diagrams side by side on a small screen,
   "height" (text beside the image, as in the mock-up) needs a wide window. */
const defaultMode = () => window.innerWidth < 1500 ? "compact" : "height";   // "hover" is only used when it is chosen
const smallImages = mode => mode === "compact" || mode === "hover";
const readLayout = (params, h) => {
  const mode = ["grid", "height", "compact", "hover"].includes(params.get("mode")) ? params.get("mode") : defaultMode();
  return { mode, cols: +(params.get("cols") || 4), h: +(params.get("h") || (smallImages(mode) ? Math.round(h * 0.75) : h)) };
};
const layoutParams = (ui, h) => ({ mode: ui.mode !== defaultMode() ? ui.mode : "", cols: ui.mode === "grid" && ui.cols !== 4 ? ui.cols : "", h: ui.h !== (smallImages(ui.mode) ? Math.round(h * 0.75) : h) ? ui.h : "" });
function bindLayout(ui, target, changed) {
  const select = $("#layout"), slider = $("#h"), label = $("#size-label");
  const show = () => {
    const grid = ui.mode === "grid";
    select.value = ui.mode; label.textContent = grid ? "Spalten" : "Bildhöhe";
    Object.assign(slider, { min: grid ? 2 : 80, max: grid ? 12 : 500, step: grid ? 1 : 10, value: grid ? ui.cols : ui.h });
    target.classList.toggle("grid-mode", grid); target.classList.toggle("compact-mode", ui.mode === "compact"); target.classList.toggle("hover-mode", ui.mode === "hover"); target.style.setProperty("--h", ui.h + "px"); target.style.setProperty("--cols", ui.cols);
  };
  select.onchange = () => { ui.mode = select.value; show(); changed(); };
  slider.oninput = () => { if (ui.mode === "grid") ui.cols = +slider.value; else ui.h = +slider.value; show(); };
  slider.onchange = changed;
  show();
}

/* ------------------------------------------------------------------ 3 diagram card */
/* Pictures. An <img> says what it shows (\`data-pic\` = image id, \`data-max\`, \`data-rot\`, \`data-tilt\`, or \`data-edition\` = id of an edited
   schema) and the host gives its address: the program that runs on a computer serves them from its web address; the browser version makes
   them in the browser and gives object URLs (web/src/host.ts sets \`window.synopsisHost\`). The same goes for the downloads. */
const host = window.synopsisHost || {
  pictureUrl: (id, o) => Promise.resolve(\`/api/synopsis/images/\${id}?\${o.max ? "max=" + o.max + "&" : ""}rot=\${o.rot || 0}\${o.tilt ? "&tilt=" + o.tilt : ""}\`),
  editionImageUrl: id => Promise.resolve(\`/api/synopsis/editions/\${id}/image?v=\${Date.now()}\`),
  download: null,   // links with data-download work as plain links
};
const picAttrs = (it, imageId, max) => \`data-pic="\${imageId}"\${max ? \` data-max="\${max}"\` : ""} data-rot="\${it.rotation}"\${it.tilt ? \` data-tilt="\${it.tilt}"\` : ""}\`;
/* Loads the picture of an <img> (again after it was turned or straightened). */
function setPicture(img, o) {
  for (const [k, v] of Object.entries({ pic: o.id, max: o.max, rot: o.rot, tilt: o.tilt })) { if (v) img.dataset[k] = v; else delete img.dataset[k]; }
  const key = \`\${o.id}|\${o.max || ""}|\${o.rot || 0}|\${o.tilt || 0}\`;
  img.dataset.picKey = key;
  host.pictureUrl(o.id, { max: o.max, rot: o.rot || 0, tilt: o.tilt || 0 }).then(url => { if (img.dataset.picKey === key) img.src = url; }, () => { img.alt = "Bild nicht verfügbar"; });
}
/* A picture is requested when its <img> comes near the visible part of the page (the browser version makes pictures one after the other,
   so only those that are needed should be asked for). */
const picturesInView = "IntersectionObserver" in window ? new IntersectionObserver(entries => entries.forEach(entry => {
  if (!entry.isIntersecting) return;
  const img = entry.target;
  picturesInView.unobserve(img);
  if (img.dataset.pic && !img.dataset.picKey) setPicture(img, { id: +img.dataset.pic, max: +img.dataset.max || 0, rot: +img.dataset.rot || 0, tilt: +img.dataset.tilt || 0 });
}), { rootMargin: "400px" }) : null;
const loadPictures = node => {
  if (node.nodeType !== 1) return;
  const imgs = node.matches("img") ? [node] : node.querySelectorAll("img");
  for (const img of imgs) {
    if (img.dataset.pic && !img.dataset.picKey) {
      if (picturesInView) picturesInView.observe(img);
      else setPicture(img, { id: +img.dataset.pic, max: +img.dataset.max || 0, rot: +img.dataset.rot || 0, tilt: +img.dataset.tilt || 0 });
    }
    else if (img.dataset.edition && !img.dataset.picKey) { img.dataset.picKey = "e"; host.editionImageUrl(+img.dataset.edition).then(url => { img.src = url; }, () => {}); }
  }
};
new MutationObserver(list => list.forEach(m => m.addedNodes.forEach(loadPictures))).observe(document.body, { childList: true, subtree: true });
document.addEventListener("click", e => {   // downloads of the browser version (backup, workbook)
  const link = e.target.closest && e.target.closest("a[data-download]");
  if (link && host.download) { e.preventDefault(); host.download(link.dataset.download); }
});
const SOURCE_LABELS = { "": "nicht angegeben", library: "Bibliotheksbild", "private-photo": "privates Foto" };
const STATUS_LABELS = { present: "Diagramm vorhanden", absent: "kein Diagramm in dieser Handschrift (geprüft)", "erased-layer": "getilgte frühere Schicht" };

/* One diagram as the researcher's mock-up shows it: the image on the left, a text block on the right (siglum and folio, link,
   book and chapter, Friedlein page and line, locus, schema, level of differentiation, comment).
   \`o\`: { siglum: show the siglum in the title, hide: offer the "x" that hides the diagram, del: offer "delete",
   group: code of the locus group the card stands in, locus: that locus (book, chapter, Friedlein page) }. */
function synCard(it, o = {}) {
  const absent = it.status === "absent", l = o.locus;
  const imgs = it.images.map(im => \`<img loading="lazy" data-image="\${im.id}" \${picAttrs(it, im.id, 900)} alt="\${esc(it.siglum)} \${esc(it.folio)}" title="\${esc(im.folio)}\${it.images.length > 1 ? " (Teil " + im.part + ")" : ""}">\`).join("");
  const chipList = [
    it.role === "component" ? \`<span class="chip" title="Dieses Diagramm umfasst mehrere Diagrammstellen">Teil von \${esc(it.primary_locus)}</span>\` : "",
    it.status === "erased-layer" ? '<span class="chip auto">Rasur</span>' : "",
    absent && imgs ? '<span class="chip auto">fehlt</span>' : "",
    it.image_source === "private-photo" ? '<span class="chip" title="Privates Foto: Rechte vor einer Veröffentlichung klären">privates Foto</span>' : "",
    it.hand ? \`<span class="chip" title="Hand (in den Details änderbar)">\${esc(it.hand)}</span>\` : "",
    (it.links || []).length ? \`<span class="chip" title="Verweise: \${esc(it.links.map(l => l.siglum + " " + l.folio).join(", "))}">↔ \${it.links.length}</span>\` : "",
  ].join("");
  const link = it.iiif_link ? \`<a href="\${esc(it.iiif_link)}" target="_blank" rel="noopener" title="Seite im Viewer der Bibliothek öffnen">↗ Seite</a>\`
    : it.ms_url ? \`<a class="muted" href="\${esc(it.ms_url)}" target="_blank" rel="noopener" title="Kein Link zur Seite hinterlegt; öffnet die ganze Handschrift">↗ Handschrift</a>\` : '<span class="muted">–</span>';
  const fried = l && l.friedlein_page ? \`S. \${l.friedlein_page}\${l.friedlein_line ? ", Z. " + l.friedlein_line : ""} (Friedlein)\` : "";
  return \`<div class="syn-card \${absent ? "is-absent" : ""} \${it.hidden ? "is-hidden" : ""} \${SEL.has(it.id) ? "is-selected" : ""}" data-id="\${it.id}" data-group="\${esc(o.group ?? "")}"\${o.drag ? ' draggable="true" title="In eine andere Schema-Gruppe ziehen, um zu klassifizieren"' : ""}>
    \${o.hide ? \`<button class="syn-x" data-act="hide" title="\${it.hidden ? "Wieder anzeigen" : "Dieses Diagramm ausblenden; die anderen rücken nach"}">\${it.hidden ? "↺" : "×"}</button>\` : ""}
    <div class="syn-img">\${imgs || (absent ? '<span class="muted small">In dieser Handschrift kein Diagramm (geprüft)</span>' : '<span class="muted small">kein Bild</span>')}</div>
    <div class="syn-text">
      <div class="syn-title"><input type="checkbox" class="syn-sel" data-sel title="Für Mehrfachbearbeitung oder Vergleich auswählen" \${SEL.has(it.id) ? "checked" : ""}> <strong>\${o.siglum === false ? "" : esc(it.siglum) + ", "}\${/^\\d/.test(it.folio) ? "f. " : ""}\${esc(it.folio) || "–"}</strong> <span class="syn-chips">\${chipList}</span></div>
      <div class="syn-rest"><div class="syn-chips-pop">\${chipList}</div>
      <div>Link: \${link}</div>
      \${l ? \`<div class="syn-ref"><div>\${l.book ? \`Buch: \${esc(l.book)}\` : ""} \${l.chapter ? \`Kapitel: \${esc(l.chapter)}\` : ""}</div>\${fried ? \`<div>\${esc(fried)}</div>\` : ""}<div><strong>\${esc(l.code)}</strong></div></div>\` : ""}
      <div class="syn-fields">
        <div class="syn-f"><label>Schema: <input data-f="schema_value" list="syn-schema" size="4" value="\${esc(it.schema_value)}" placeholder="\${esc(it.schema_raw)}"></label><label class="q" title="unsicher"><input type="checkbox" data-f="schema_uncertain" \${it.schema_uncertain ? "checked" : ""}>?</label></div>
        <div class="syn-f"><label>Differenzierungsebene: <input data-f="level_value" list="syn-level" size="3" value="\${esc(it.level_value)}" placeholder="\${esc(it.level_raw)}"></label><label class="q" title="unsicher"><input type="checkbox" data-f="level_uncertain" \${it.level_uncertain ? "checked" : ""}>?</label></div>
      </div>
      \${it.tags.length ? \`<div class="syn-tags" title="\${esc(it.tags.map(t => t.name).join(", "))}">\${it.tags.slice(0, 3).map(t => esc(t.name)).join(" · ")}\${it.tags.length > 3 ? " +" + (it.tags.length - 3) : ""}</div>\` : ""}
      <label class="syn-clabel">Kommentar<textarea class="syn-comment" data-f="comment" rows="1" placeholder="Kommentar">\${esc(it.comment)}</textarea></label>
      <div class="syn-actions">
        <button class="link" data-act="rotate" title="Anzeige um 90° drehen (die Datei bleibt unverändert)">⟳ drehen</button>
        <button class="link" data-act="details" title="Großes Bild und alle Angaben zu diesem Diagramm">Details</button>
        \${o.del ? '<button class="link danger" data-act="delete" title="Diagramm samt Bilddateien löschen">löschen</button>' : ""}
        <span class="saved small" hidden>gespeichert</span></div>
      </div>
    </div>
  </div>\`;
}

/* Items of a response that is grouped by locus: all copies of the item with this id (an item can appear in several groups).
   \`ctl.all\` (every group of a page that filters on the client) takes precedence over \`ctl.data\` (the groups shown). */
const dataOf = ctl => ctl.all ?? ctl.data;
const locusOf = (ctl, group) => dataOf(ctl).groups.find(g => (g.locus?.code ?? "") === group)?.locus;
const itemCopies = (ctl, id) => dataOf(ctl).groups.flatMap(g => g.items).filter(i => i.id === id);
const copyFor = (ctl, id, group) => dataOf(ctl).groups.find(g => (g.locus?.code ?? "") === group && g.items.some(i => i.id === id))?.items.find(i => i.id === id) ?? itemCopies(ctl, id)[0];

/* Saves one change of an item and merges the saved item into every copy held by the page. A new schema, level or hand
   is offered in the filters and suggestions at once: the page's \`ctl.afterSave\` reloads those lists. */
async function patchItem(ctl, id, patch) {
  const saved = await api(\`/synopsis/items/\${id}\`, { method: "PATCH", body: patch });
  itemCopies(ctl, id).forEach(it => Object.assign(it, saved));
  if (ctl.afterSave && ["schema_value", "level_value", "hand"].some(k => k in patch)) ctl.afterSave();
  return saved;
}

/* Draws the cards of one item again, each in its place (the order of the cards does not change). */
function refreshCards(root, ctl, id, except = null) {
  root.querySelectorAll(\`.syn-card[data-id="\${id}"]\`).forEach(card => {
    if (card === except) return;
    const holder = document.createElement("div");
    holder.innerHTML = synCard(copyFor(ctl, id, card.dataset.group), { ...ctl.cardOptions, group: card.dataset.group, locus: locusOf(ctl, card.dataset.group) });
    const fresh = holder.firstElementChild;   // taken before it moves out of \`holder\`
    card.replaceWith(fresh);
    flash(fresh);
  });
}

/* Makes the cards inside \`root\` work: edits are saved at once, plus rotate, details, hide and delete.
   \`ctl\`: { data (or all): the grouped response, cardOptions, loci, redraw(): draw again, reload(): fetch and draw again }. */
function bindCards(root, ctl) {
  async function save(card, patch) {
    const id = +card.dataset.id;
    let saved;
    try { saved = await patchItem(ctl, id, patch); } catch (e) { alert(e.message); return null; }
    refreshCards(root, ctl, id, card);   // the same diagram shown under another locus
    flash(card);
    return saved;
  }
  bulk = { ctl, root }; drawBulk(); bindPopover(root);
  root.onchange = e => {
    if (e.target.dataset.sel !== undefined) {
      const card = e.target.closest(".syn-card"), id = +card.dataset.id;
      e.target.checked ? SEL.add(id) : SEL.delete(id);
      root.querySelectorAll(\`.syn-card[data-id="\${id}"]\`).forEach(c => { c.classList.toggle("is-selected", SEL.has(id)); c.querySelector("[data-sel]").checked = SEL.has(id); });
      drawBulk(); return;
    }
    const field = e.target.dataset.f, card = e.target.closest(".syn-card");
    if (field && card) save(card, { [field]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  };
  root.onclick = async e => {
    const card = e.target.closest(".syn-card"); if (!card) return;
    const id = +card.dataset.id, it = copyFor(ctl, id, card.dataset.group), act = e.target.dataset.act;
    if (act === "rotate") {
      const saved = await save(card, { rotation: (it.rotation + 90) % 360 }); if (!saved) return;
      card.querySelectorAll("img").forEach(img => setPicture(img, { id: +img.dataset.image, max: 900, rot: saved.rotation, tilt: saved.tilt }));
    } else if (act === "hide") {
      if (await save(card, { hidden: !it.hidden })) ctl.redraw();
    } else if (act === "delete") {
      if (!confirm(\`\${[it.siglum, it.folio].filter(Boolean).join(" ")} (\${it.loci.map(l => l.code).join(", ") || "ohne Diagrammstelle"}) samt Bilddateien löschen? Das kann nicht rückgängig gemacht werden.\`)) return;
      try { await api(\`/synopsis/items/\${id}\`, { method: "DELETE" }); } catch (err) { alert(err.message); return; }
      ctl.reload();
    } else if (act === "details" || e.target.closest(".syn-img img")) detailDialog(it, ctl, root);
  };
}

/* Layout "hover": only the images and a caption are shown; the details of a card (\`.syn-rest\`) appear beside the image while the
   pointer is on the card or a field of it has focus, and may cover other images. The side and height are chosen so that the
   panel stays inside the window. */
function bindPopover(root) {
  if (root.popoverBound) return;
  root.popoverBound = true;
  let open = null, timer = null;
  const place = card => {
    const panel = card.querySelector(".syn-rest"), r = card.getBoundingClientRect(), w = panel.offsetWidth, h = panel.offsetHeight;
    const right = innerWidth - r.right >= w + 10, left = r.left >= w + 10;
    panel.style.left = right ? \`\${r.width + 6}px\` : left ? \`\${-(w + 6)}px\` : \`\${Math.max(-r.left + 6, Math.min(0, innerWidth - r.left - w - 6))}px\`;
    const below = !right && !left;   // no room at the sides: the panel covers the lower part of the card
    const wanted = below ? r.height * 0.55 : 0;
    panel.style.top = \`\${Math.max(-r.top + 6, Math.min(wanted, innerHeight - 76 - r.top - h))}px\`;
  };
  const show = card => {
    clearTimeout(timer);
    if (open === card) return;
    if (open) open.classList.remove("is-pop");
    open = card; card.classList.add("is-pop"); place(card);
  };
  const hide = card => {
    clearTimeout(timer);
    timer = setTimeout(() => { if (open === card && !card.matches(":hover") && !card.contains(document.activeElement)) { card.classList.remove("is-pop"); open = null; } }, 160);
  };
  root.addEventListener("mouseover", e => { const card = root.classList.contains("hover-mode") && e.target.closest(".syn-card"); if (card) show(card); });
  root.addEventListener("mouseout", e => { const card = e.target.closest(".syn-card"); if (card && !card.contains(e.relatedTarget)) hide(card); });
  root.addEventListener("focusout", e => { const card = e.target.closest(".syn-card"); if (card) hide(card); });
}

/* A short message at the bottom of the page, optionally with "Undo". */
let toastTimer;
function toast(message, undo) {
  let el = document.getElementById("toast");
  if (!el) { el = document.createElement("div"); el.id = "toast"; document.body.appendChild(el); }
  el.innerHTML = \`<span>\${esc(message)}</span>\${undo ? ' <button class="link" id="toast-undo">Rückgängig</button>' : ""}\`;
  el.hidden = false; clearTimeout(toastTimer);
  if (undo) document.getElementById("toast-undo").onclick = async () => { el.hidden = true; await undo(); };
  toastTimer = setTimeout(() => { el.hidden = true; }, 9000);
}

/* Classify by sorting: a card can be dragged into another schema group of the same locus (or into "New schema group"),
   which sets its schema and level to those of the group. \`rerender()\` draws the page again; "Undo" puts the old values back. */
function bindDnd(root, ctl, rerender) {
  let drag = null;
  const targetOf = e => { const b = e.target.closest && e.target.closest(".syn-block[data-drop], .syn-block[data-newschema]"); return drag && b && b.dataset.group === drag.group ? b : null; };
  root.addEventListener("dragstart", e => {
    const card = e.target.closest && e.target.closest(".syn-card[draggable]"); if (!card) return;
    drag = { id: +card.dataset.id, group: card.dataset.group };
    e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(drag.id)); card.classList.add("dragging");
  });
  root.addEventListener("dragend", () => { drag = null; root.querySelectorAll(".dragging, .drop-ok").forEach(el => el.classList.remove("dragging", "drop-ok")); });
  root.addEventListener("dragover", e => {
    const block = targetOf(e); if (!block) return;
    e.preventDefault(); e.dataTransfer.dropEffect = "move";
    root.querySelectorAll(".drop-ok").forEach(el => { if (el !== block) el.classList.remove("drop-ok"); });
    block.classList.add("drop-ok");
  });
  root.addEventListener("drop", async e => {
    const block = targetOf(e); if (!block) return;
    e.preventDefault();
    const it = copyFor(ctl, drag.id, drag.group);
    let patch, label;
    if (block.hasAttribute("data-newschema")) {
      const answer = prompt("Schema (und Differenzierungsebene) der neuen Gruppe, zum Beispiel IV oder II b:");
      if (!answer || !answer.trim()) return;
      const [schema, level = ""] = answer.trim().split(/\\s+/);
      patch = { schema_value: schema, schema_uncertain: false, level_value: level, level_uncertain: false };
      label = \`Schema \${schema}\${level ? " · Ebene " + level : ""}\`;
    } else {
      patch = { schema_value: block.dataset.schema, schema_uncertain: block.dataset.schemaU === "1", level_value: block.dataset.level, level_uncertain: block.dataset.levelU === "1" };
      label = block.querySelector(".syn-sub").textContent.trim();
    }
    const before = { schema_value: it.schema_value, schema_uncertain: !!it.schema_uncertain, level_value: it.level_value, level_uncertain: !!it.level_uncertain };
    if (Object.keys(patch).every(k => patch[k] === before[k])) return;
    const id = drag.id;
    try { await patchItem(ctl, id, patch); } catch (err) { alert(err.message); return; }
    rerender();
    toast(\`\${it.siglum} \${it.folio} → \${label}\`, async () => { await patchItem(ctl, id, before); rerender(); });
  });
}

/* ---- selection, editing many diagrams at once, comparing two diagrams */
const SEL = new Set();   // ids of the diagrams ticked on the page
let bulk = null;         // { ctl, root } of the page that owns the bar at the bottom
function clearSelection() { SEL.clear(); bulk = null; const bar = document.getElementById("bulkbar"); if (bar) bar.hidden = true; }

const FIELD_DE = { schema_value: "Schema", schema_uncertain: "Schema unsicher", level_value: "Differenzierungsebene", level_uncertain: "Ebene unsicher", hand: "Hand",
  comment: "Kommentar", apparatus: "Apparat", status: "Status", layout_place: "Platz auf der Seite", image_source: "Bildquelle", iiif_link: "Link", tag: "Tag" };

/* The bar at the bottom of the page while diagrams are ticked: set schema, level, hand or a tag for all of them (one undo step), or compare two. */
function drawBulk() {
  let bar = document.getElementById("bulkbar");
  if (!bar) { bar = document.createElement("div"); bar.id = "bulkbar"; bar.hidden = true; document.body.appendChild(bar); }
  if (!bulk || !SEL.size) { bar.hidden = true; return; }
  if (bar.hidden) {
    const cats = Object.entries(bulk.ctl.opt.tag_categories);
    bar.innerHTML = \`<strong id="b-n"></strong>
      <label>Schema <input id="b-schema" list="syn-schema" size="4"></label><label class="q"><input type="checkbox" id="b-schema-u">?</label>
      <label>Differenzierungsebene <input id="b-level" list="syn-level" size="3"></label><label class="q"><input type="checkbox" id="b-level-u">?</label>
      <label>Hand <input id="b-hand" list="syn-hand" size="8"></label>
      <label>Tag <select id="b-cat">\${cats.map(([c, n]) => \`<option value="\${c}">\${esc(n)}</option>\`).join("")}</select><input id="b-tag" size="12"></label>
      <button class="primary" id="b-apply" title="Leere Felder bleiben unverändert">Auf alle anwenden</button>
      <button id="b-compare" hidden>Die zwei vergleichen</button>
      <button class="link" id="b-visible">alle angezeigten wählen</button><button class="link" id="b-clear">Auswahl aufheben</button>\`;
    bar.querySelector("#b-clear").onclick = () => { SEL.clear(); bulk.root.querySelectorAll(".syn-card.is-selected").forEach(c => { c.classList.remove("is-selected"); c.querySelector("[data-sel]").checked = false; }); drawBulk(); };
    bar.querySelector("#b-visible").onclick = () => {
      bulk.root.querySelectorAll(".syn-card:not(.is-hidden)").forEach(c => { SEL.add(+c.dataset.id); c.classList.add("is-selected"); c.querySelector("[data-sel]").checked = true; });
      drawBulk();
    };
    bar.querySelector("#b-compare").onclick = () => {
      const [a, b] = [...SEL].map(id => itemCopies(bulk.ctl, id)[0]);
      if (a && b) compareDialog(a, b);
    };
    bar.querySelector("#b-apply").onclick = applyBulk;
  }
  bar.hidden = false;
  bar.querySelector("#b-n").textContent = \`\${SEL.size} ausgewählt\`;
  bar.querySelector("#b-compare").hidden = SEL.size !== 2;
}

async function applyBulk() {
  const bar = document.getElementById("bulkbar"), v = id => bar.querySelector(id).value.trim(), { ctl } = bulk;
  const patch = {};
  if (v("#b-schema")) Object.assign(patch, { schema_value: v("#b-schema"), schema_uncertain: bar.querySelector("#b-schema-u").checked });
  if (v("#b-level")) Object.assign(patch, { level_value: v("#b-level"), level_uncertain: bar.querySelector("#b-level-u").checked });
  if (v("#b-hand")) patch.hand = v("#b-hand");
  const add_tags = v("#b-tag") ? [{ category: bar.querySelector("#b-cat").value, name: v("#b-tag") }] : [];
  if (!Object.keys(patch).length && !add_tags.length) { toast("Nichts einzutragen: mindestens ein Feld füllen."); return; }
  const ids = [...SEL];
  let result;
  try { result = await api("/synopsis/items/bulk", { method: "POST", body: { ids, patch, add_tags } }); } catch (e) { alert(e.message); return; }
  const merge = items => items.forEach(saved => itemCopies(ctl, saved.id).forEach(it => Object.assign(it, saved)));
  merge(result.items);
  if (ctl.afterSave) ctl.afterSave();
  ctl.redraw();
  ["#b-schema", "#b-level", "#b-hand", "#b-tag"].forEach(id => { bar.querySelector(id).value = ""; });
  bar.querySelectorAll("#b-schema-u, #b-level-u").forEach(c => { c.checked = false; });
  toast(\`\${ids.length} Diagramme geändert\`, async () => {
    const back = await api("/synopsis/changes/revert", { method: "POST", body: { ids: result.changes } });
    merge(back.items); if (ctl.afterSave) ctl.afterSave(); ctl.redraw();
  });
}

/* Two diagrams side by side. With "couple" on, zooming and moving one image does the same to the other. */
function compareDialog(a, b) {
  const dlg = $("#dialog");
  const pane = it => \`<div class="cmp-pane"><div class="cmp-title"><strong>\${esc(it.siglum)}, \${/^\\d/.test(it.folio) ? "f. " : ""}\${esc(it.folio)}</strong>
    <span class="muted small">Schema \${esc(it.schema_value || "–")}\${it.schema_uncertain ? "?" : ""} · Ebene \${esc(it.level_value || "–")}</span></div>
    <div class="viewer-stage cmp-stage"><div class="viewer-pan">\${it.images.map(im => \`<img \${picAttrs(it, im.id)} alt="" draggable="false">\`).join("") || '<span class="muted viewer-none">kein Bild</span>'}</div></div></div>\`;
  dlg.style.width = "min(1500px, 96vw)"; dlg.style.maxWidth = "none";
  dlg.innerHTML = \`<div class="row"><h1 style="margin:0">Zwei Diagramme vergleichen</h1><span style="flex:1"></span>
    <label><input type="checkbox" id="cmp-sync" checked> Zoom und Verschieben koppeln</label><button id="cmp-fit" type="button">einpassen</button><button id="close" type="button">Schließen</button></div>
    <p class="muted small">Mausrad: zoomen · ziehen: verschieben · Doppelklick: einpassen.</p><div class="cmp">\${pane(a)}\${pane(b)}</div>\`;
  const stages = [...dlg.querySelectorAll(".cmp-stage")], pans = stages.map(st => st.firstElementChild), views = stages.map(() => ({ s: 1, x: 0, y: 0 }));
  const draw = i => { pans[i].style.transform = \`translate(\${views[i].x}px, \${views[i].y}px) scale(\${views[i].s})\`; };
  const synced = () => dlg.querySelector("#cmp-sync").checked;
  const targets = i => synced() ? views.map((_, j) => j) : [i];
  const fit = i => {
    const w = pans[i].offsetWidth, h = pans[i].offsetHeight, W = stages[i].clientWidth, H = stages[i].clientHeight; if (!w || !h) return;
    const s = Math.min(W / w, H / h, 1); views[i] = { s, x: (W - w * s) / 2, y: (H - h * s) / 2 }; draw(i);
  };
  const zoom = (i, factor, cx, cy) => targets(i).forEach(j => {
    const v = views[j], s = Math.min(12, Math.max(0.05, v.s * factor));
    v.x = cx - (cx - v.x) * s / v.s; v.y = cy - (cy - v.y) * s / v.s; v.s = s; draw(j);
  });
  const move = (i, dx, dy) => targets(i).forEach(j => { views[j].x += dx; views[j].y += dy; draw(j); });
  stages.forEach((st, i) => {
    st.onwheel = e => { e.preventDefault(); const r = st.getBoundingClientRect(); zoom(i, e.deltaY < 0 ? 1.18 : 1 / 1.18, e.clientX - r.left, e.clientY - r.top); };
    let last = null;
    st.onpointerdown = e => { last = { x: e.clientX, y: e.clientY }; st.setPointerCapture(e.pointerId); st.classList.add("panning"); };
    st.onpointermove = e => { if (last) { move(i, e.clientX - last.x, e.clientY - last.y); last = { x: e.clientX, y: e.clientY }; } };
    st.onpointerup = st.onpointercancel = () => { last = null; st.classList.remove("panning"); };
    st.ondblclick = () => targets(i).forEach(fit);
    pans[i].querySelectorAll("img").forEach(img => { img.onload = () => fit(i); if (img.complete) fit(i); });
  });
  dlg.querySelector("#cmp-fit").onclick = () => stages.forEach((_, i) => fit(i));
  dlg.addEventListener("close", () => { dlg.style.width = dlg.style.maxWidth = ""; }, { once: true });
  dlg.querySelector("#close").onclick = () => dlg.close();
  dlg.showModal();
  stages.forEach((_, i) => fit(i));
}

/* The details of one diagram, as HTML for the detail window and for the page of its own: a viewer (zoom, move, turn, straighten)
   and every field, the tags, the apparatus notes and the edited version of the schema. See bindItemDetail. */
function itemDetailHtml(it, ctl) {
  const locusInfo = l => { const info = ctl.loci.find(x => x.code === l.code);
    return \`<li><strong>\${esc(l.code)}</strong>\${l.role === "component" ? " (Teil einer zusammengesetzten Stelle)" : ""} <span class="muted">\${info ? esc(locusLine(info)) : ""}</span></li>\`; };
  const raw = [it.schema_raw && \`Schema \${it.schema_raw}\`, it.level_raw && \`Ebene \${it.level_raw}\`].filter(Boolean).join(", ");
  const sizes = it.images.map(im => \`\${it.images.length > 1 ? "Teil " + im.part + ": " : ""}\${im.width} × \${im.height} px\`).join("; ");
  const option = (labels, current) => Object.entries(labels).map(([v, l]) => \`<option value="\${esc(v)}" \${v === current ? "selected" : ""}>\${esc(l)}</option>\`).join("");
  return \`<div class="detail">
      <div class="detail-img">
        <div class="viewer-tools small">
          <button class="link" data-view="in" title="Vergrößern (oder Mausrad)">＋</button><button class="link" data-view="out" title="Verkleinern">－</button>
          <button class="link" data-view="fit">einpassen</button><button class="link" data-view="full">100 %</button>
          <button class="link" id="d-rotate" title="Um 90 Grad drehen">⟳ 90°</button>
          <label title="Ein schiefes Diagramm geraderichten (Feindrehung, wird gespeichert)">geraderichten <input type="range" id="d-tilt" min="-45" max="45" step="0.5" value="\${it.tilt}"> <span id="d-tilt-v">\${it.tilt}°</span></label>
          <button class="link" id="d-tilt-0">zurücksetzen</button>
        </div>
        <div class="viewer-stage" id="stage" title="Mausrad: zoomen · ziehen: verschieben · Doppelklick: vergrößern oder einpassen">
          <div class="viewer-pan" id="pan">\${it.images.map(im => \`<img data-image="\${im.id}" \${picAttrs(it, im.id)} alt="" draggable="false">\`).join("") || '<span class="muted viewer-none">kein Bild</span>'}</div></div>
      </div>
      <div class="detail-meta">
        <dl class="detail-facts">
          <dt>Handschrift</dt><dd><a href="#/synopsis/manuscript?id=\${it.manuscript_id}">\${esc(it.siglum)}</a> <span class="muted">\${esc(it.provenance)}</span></dd>
          <dt>Diagrammstelle</dt><dd><ul>\${it.loci.map(locusInfo).join("") || "keine"}</ul></dd>
          \${sizes ? \`<dt>Bild</dt><dd>\${esc(sizes)}</dd>\` : ""}
          <dt>Herkunft des Datensatzes</dt><dd>\${esc(it.source_row || "–")}\${raw ? \`; so in der Tabelle geschrieben: \${esc(raw)}\` : ""}</dd>
        </dl>
        <form class="form-grid" id="d-form" onsubmit="return false">
          <label class="field">Platz auf der Seite<input data-f="layout_place" value="\${esc(it.layout_place)}"></label>
          <label class="field">Status<select data-f="status">\${option(STATUS_LABELS, it.status)}</select></label>
          <div class="field">Schema <input data-f="schema_value" list="syn-schema" size="5" value="\${esc(it.schema_value)}"> <label><input type="checkbox" data-f="schema_uncertain" \${it.schema_uncertain ? "checked" : ""}> unsicher</label></div>
          <div class="field">Differenzierungsebene <input data-f="level_value" list="syn-level" size="5" value="\${esc(it.level_value)}"> <label><input type="checkbox" data-f="level_uncertain" \${it.level_uncertain ? "checked" : ""}> unsicher</label></div>
          <label class="field">Hand (Schreiber oder Schicht)<input data-f="hand" list="syn-hand" value="\${esc(it.hand)}" placeholder="z. B. A, B, spätere Hand"></label>
          <label class="field">Bildquelle<select data-f="image_source">\${option(SOURCE_LABELS, it.image_source)}</select></label>
          <label class="field wide">Kommentar<textarea data-f="comment" rows="3">\${esc(it.comment)}</textarea></label>
          <label class="field wide">Apparat (längere Anmerkungen zu diesem Diagramm)<textarea data-f="apparatus" rows="4">\${esc(it.apparatus)}</textarea></label>
          <label class="field wide">Link zur Seite im Viewer der Bibliothek<input data-f="iiif_link" value="\${esc(it.iiif_link)}" placeholder="https://…"></label>
        </form>
        <h3 class="detail-h">Tags</h3>
        <div class="tags-edit" id="tags"></div>
        <h3 class="detail-h">Verweise auf andere Diagramme</h3>
        <div id="links"></div>
        <h3 class="detail-h">Edierte Fassung des Schemas</h3>
        <div id="edition"></div>
      </div>
    </div>\`;
}

/* Makes the details of one diagram work inside \`host\` (the dialog or the page): viewer, fields, tags, edition. All changes are
   saved at once; \`ctl.afterSave\` is told when a value that the filters offer (schema, level, hand, tag) changed. */
function bindItemDetail(host, it0, ctl) {
  const id = it0.id, cur = () => itemCopies(ctl, id)[0], q = sel => host.querySelector(sel);
  const apply = async patch => { try { const saved = await patchItem(ctl, id, patch); flash(host); return saved; } catch (e) { alert(e.message); return null; } };

  /* viewer: zoom with the wheel, move by dragging */
  const stage = q("#stage"), pan = q("#pan"), view = { s: 1, x: 0, y: 0 };
  const draw = () => { pan.style.transform = \`translate(\${view.x}px, \${view.y}px) scale(\${view.s})\`; };
  const fit = () => {
    const w = pan.offsetWidth, h = pan.offsetHeight, W = stage.clientWidth, H = stage.clientHeight;
    if (!w || !h) return;
    view.s = Math.min(W / w, H / h, 1); view.x = (W - w * view.s) / 2; view.y = (H - h * view.s) / 2; draw();
  };
  const zoomAt = (factor, cx, cy) => {
    const s = Math.min(12, Math.max(0.05, view.s * factor));
    view.x = cx - (cx - view.x) * s / view.s; view.y = cy - (cy - view.y) * s / view.s; view.s = s; draw();
  };
  const centre = factor => zoomAt(factor, stage.clientWidth / 2, stage.clientHeight / 2);
  stage.onwheel = e => { e.preventDefault(); const r = stage.getBoundingClientRect(); zoomAt(e.deltaY < 0 ? 1.18 : 1 / 1.18, e.clientX - r.left, e.clientY - r.top); };
  let grab = null;
  stage.onpointerdown = e => { grab = { x: e.clientX - view.x, y: e.clientY - view.y }; stage.setPointerCapture(e.pointerId); stage.classList.add("panning"); };
  stage.onpointermove = e => { if (grab) { view.x = e.clientX - grab.x; view.y = e.clientY - grab.y; draw(); } };
  stage.onpointerup = stage.onpointercancel = () => { grab = null; stage.classList.remove("panning"); };
  stage.ondblclick = e => { const r = stage.getBoundingClientRect(); if (view.s < 1.4) zoomAt(2.5, e.clientX - r.left, e.clientY - r.top); else fit(); };
  host.querySelectorAll("[data-view]").forEach(b => b.onclick = () => {
    const how = b.dataset.view;
    if (how === "in") centre(1.4); else if (how === "out") centre(1 / 1.4); else if (how === "fit") fit();
    else { const f = 1 / view.s; zoomAt(f, stage.clientWidth / 2, stage.clientHeight / 2); }
  });
  const reload = () => pan.querySelectorAll("img").forEach(img => { img.onload = fit; setPicture(img, { id: +img.dataset.image, rot: cur().rotation, tilt: cur().tilt }); });
  pan.querySelectorAll("img").forEach(img => { img.onload = fit; if (img.complete) fit(); });

  /* turn by 90 degrees, straighten by a fine angle (the slider shows the change at once; the straightened image is made on release) */
  q("#d-rotate").onclick = async () => { if (await apply({ rotation: (cur().rotation + 90) % 360 })) reload(); };
  const slider = q("#d-tilt"), label = q("#d-tilt-v");
  slider.oninput = () => {
    label.textContent = slider.value + "°";
    pan.querySelectorAll("img").forEach(img => { img.style.transform = \`rotate(\${slider.value - cur().tilt}deg)\`; });
  };
  slider.onchange = async () => { const saved = await apply({ tilt: +slider.value }); pan.querySelectorAll("img").forEach(img => { img.style.transform = ""; }); if (saved) reload(); };
  q("#d-tilt-0").onclick = async () => { slider.value = 0; label.textContent = "0°"; if (await apply({ tilt: 0 })) { pan.querySelectorAll("img").forEach(img => { img.style.transform = ""; }); reload(); } };

  /* fields */
  q("#d-form").onchange = async e => {
    const f = e.target.dataset.f; if (!f) return;
    await apply({ [f]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
    if (f === "schema_value") loadEdition();
  };

  /* tags: three categories, each with its tags and an input that adds one (a new tag is created on the way) */
  const cats = () => ctl.opt.tag_categories;
  const drawTags = focusCat => {
    q("#tags").innerHTML = Object.entries(cats()).map(([cat, name]) => \`<div class="tag-row"><span class="tag-cat">\${esc(name)}</span>
      \${cur().tags.filter(t => t.category === cat).map(t => \`<span class="chip">\${esc(t.name)}<button type="button" class="x" data-untag="\${t.id}" title="Diesen Tag vom Diagramm entfernen">×</button></span>\`).join("")}
      <input class="tag-input" data-cat="\${cat}" list="syn-tags-\${cat}" placeholder="Tag hinzufügen …" size="14"></div>\`).join("") +
      '<div><button type="button" class="link" data-newcat title="Eine eigene Kategorie für Tags anlegen, z. B. Tinte oder Ductus">+ eigene Kategorie</button></div>';
    if (focusCat) q(\`.tag-input[data-cat="\${focusCat}"]\`).focus();
  };
  const tagsChanged = async (saved, cat) => { itemCopies(ctl, id).forEach(c => Object.assign(c, saved)); flash(host); drawTags(cat); if (ctl.afterSave) await ctl.afterSave(); };
  q("#tags").onchange = async e => {
    const input = e.target.closest(".tag-input"); if (!input || !input.value.trim()) return;
    try { await tagsChanged(await api(\`/synopsis/items/\${id}/tags\`, { method: "POST", body: { category: input.dataset.cat, name: input.value } }), input.dataset.cat); }
    catch (err) { alert(err.message); }
  };
  q("#tags").onclick = async e => {
    if (e.target.dataset.newcat !== undefined) {
      const name = prompt("Name der neuen Tag-Kategorie, z. B. Tinte oder Ductus:"); if (!name || !name.trim()) return;
      try { await api("/synopsis/tags/categories", { method: "POST", body: { name } }); } catch (err) { alert(err.message); return; }
      Object.assign(ctl.opt, await api("/synopsis/options")); updateDatalists(ctl.opt); drawTags(); return;
    }
    const b = e.target.closest("[data-untag]"); if (!b) return;
    try { await tagsChanged(await api(\`/synopsis/items/\${id}/tags/\${b.dataset.untag}\`, { method: "DELETE" })); } catch (err) { alert(err.message); }
  };
  drawTags();

  /* cross-references to other diagrams ("same as ...") */
  const drawLinks = () => {
    q("#links").innerHTML = \`<div>\${cur().links.map(l => \`<span class="chip"><a href="#/synopsis/item?id=\${l.id}">\${esc(l.siglum)}, \${esc(l.folio)}</a><button type="button" class="x" data-unlink="\${l.id}" title="Verweis entfernen">×</button></span>\`).join("") || '<span class="muted small">keine</span>'}</div>
      <div class="row small"><input id="l-q" placeholder="Sigle oder Folio suchen, z. B. Pa 8663" size="26"><button type="button" id="l-go">suchen</button></div><div id="l-found" class="small"></div>\`;
    q("#l-go").onclick = async () => {
      const text = q("#l-q").value.trim(); if (!text) return;
      const found = await api(\`/synopsis/items?q=\${encodeURIComponent(text)}\`);
      const have = new Set([id, ...cur().links.map(l => l.id)]);
      const items = [...new Map(found.groups.flatMap(g => g.items.map(i => [i.id, { ...i, locus: g.locus?.code }]))).values()].filter(i => !have.has(i.id)).slice(0, 8);
      q("#l-found").innerHTML = items.map(i => \`<button type="button" class="link" data-link="\${i.id}">↔ \${esc(i.siglum)}, \${esc(i.folio)}\${i.locus ? " (" + esc(i.locus) + ")" : ""}</button>\`).join(" ") || '<span class="muted">nichts gefunden</span>';
    };
    q("#l-q").onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); q("#l-go").click(); } };
  };
  q("#links").onclick = async e => {
    const add = e.target.dataset.link, rm = e.target.dataset.unlink;
    if (!add && !rm) return;
    try {
      const saved = add ? await api(\`/synopsis/items/\${id}/links\`, { method: "POST", body: { target: +add } }) : await api(\`/synopsis/items/\${id}/links/\${rm}\`, { method: "DELETE" });
      itemCopies(ctl, id).forEach(c => Object.assign(c, saved)); flash(host); drawLinks();
    } catch (err) { alert(err.message); }
  };
  drawLinks();

  /* the edited version of the schema (text and image) of this diagram's locus and schema */
  async function loadEdition() {
    const box = q("#edition"), c = cur(), locus = (c.loci.find(l => l.role === "primary") || {}).code;
    if (!c.schema_value || !locus) { box.innerHTML = '<span class="muted small">Dem Diagramm ein Schema (und eine Diagrammstelle) geben, um eine edierte Fassung des Schemas anzuhängen.</span>'; return; }
    const ed = await api(\`/synopsis/editions?locus=\${encodeURIComponent(locus)}&schema=\${encodeURIComponent(c.schema_value)}\`);
    box.innerHTML = ed ? \`<div class="edition">\${ed.has_image ? \`<img data-edition="\${ed.id}" alt="edierte Fassung">\` : ""}
        <div>\${ed.text ? esc(ed.text) : '<span class="muted">kein Text</span>'}</div></div><button class="link" id="ed-edit">bearbeiten</button>\`
      : \`<span class="muted small">Noch keine edierte Fassung von Schema \${esc(c.schema_value)} an Stelle \${esc(locus)}.</span> <button class="link" id="ed-edit">hinzufügen</button>\`;
    q("#ed-edit").onclick = () => editEdition(locus, c.schema_value, ed);
  }
  function editEdition(locus, schema, ed) {
    const box = q("#edition"); let staged = null;
    box.innerHTML = \`<form id="ed-form"><textarea name="text" rows="3" placeholder="Das Schema beschreiben: wie es gemeint ist, was dazugehört">\${esc(ed ? ed.text : "")}</textarea>
      <div class="paste-zone small" id="ed-zone" tabindex="0"><div id="ed-staged"></div>Eine saubere Zeichnung hier einfügen (<strong>Strg+V</strong> oder <strong>Cmd+V</strong>), ein Bild hineinziehen oder <button type="button" class="link" id="ed-choose">eine Datei wählen</button>.
        <input type="file" id="ed-picker" accept="image/*" hidden></div>
      \${ed && ed.has_image ? '<label class="small"><input type="checkbox" name="remove_image" value="true"> gespeichertes Bild entfernen</label>' : ""}
      <div class="row"><button class="primary">Speichern</button><button type="button" id="ed-cancel">Abbrechen</button></div></form>\`;
    const show = () => { q("#ed-staged").innerHTML = staged ? \`<img src="\${URL.createObjectURL(staged)}" alt="" style="max-height:100px">\` : ed && ed.has_image ? "Das aktuelle Bild bleibt, solange kein anderes hinzukommt." : ""; };
    const take = files => { if (files.length) { staged = files[0]; show(); } };
    show();
    document.onpaste = e => { const files = imagesIn(e.clipboardData); if (files.length) { e.preventDefault(); take(files); } };
    q("#ed-choose").onclick = () => q("#ed-picker").click();
    q("#ed-picker").onchange = e => take([...e.target.files]);
    q("#ed-zone").ondragover = e => e.preventDefault();
    q("#ed-zone").ondrop = e => { e.preventDefault(); take(imagesIn(e.dataTransfer)); };
    q("#ed-cancel").onclick = () => { document.onpaste = null; loadEdition(); };
    q("#ed-form").onsubmit = guard(async e => {
      e.preventDefault();
      const form = new FormData(e.target); form.set("locus", locus); form.set("schema_value", schema);
      if (staged) form.set("image", staged, staged.name || "edition.png");
      await api("/synopsis/editions", { method: "PUT", form });
      document.onpaste = null; flash(host); loadEdition();
    });
  }
  loadEdition();
}

/* The detail window of one diagram. Closing it draws the card again. */
function detailDialog(it0, ctl, root) {
  const dlg = $("#dialog"), id = it0.id, it = itemCopies(ctl, id)[0];
  dlg.innerHTML = \`<div class="row"><h1 style="margin:0">\${esc(it.siglum)} · \${esc(it.folio) || "–"}</h1>
      <a class="small" href="#/synopsis/item?id=\${id}" target="_blank" rel="noopener" title="Dieses Diagramm auf einer eigenen Seite öffnen, zum Beispiel in einem zweiten Fenster neben dem Viewer der Handschrift">in neuem Fenster öffnen ↗</a>
      <span style="flex:1"></span><span class="saved small" hidden>gespeichert</span><button id="close">Schließen</button></div>\${itemDetailHtml(it, ctl)}\`;
  bindItemDetail(dlg, it, ctl);
  dlg.addEventListener("close", () => { document.onpaste = null; refreshCards(root, ctl, id); }, { once: true });
  $("#close").onclick = () => dlg.close();
  dlg.showModal();
}

/* Draws the suggestions of the schema, level and hand inputs again from \`opt\` (after a new value was saved). */
function updateDatalists(opt) {
  const lists = [["syn-schema", opt.schemas], ["syn-level", opt.levels], ["syn-hand", opt.hands],
    ...Object.keys(opt.tag_categories).map(cat => [\`syn-tags-\${cat}\`, opt.tags.filter(t => t.category === cat).map(t => t.name)])];
  for (const [id, values] of lists) {
    let el = document.getElementById(id);
    if (!el && id.startsWith("syn-tags-")) { el = document.createElement("datalist"); el.id = id; document.body.appendChild(el); }   // a category added meanwhile
    if (el) el.innerHTML = values.map(v => \`<option value="\${esc(v)}">\`).join("");
  }
}
/* Suggestions for the schema, level and hand inputs: the values that exist. */
const classDatalists = opt => \`<datalist id="syn-schema">\${opt.schemas.map(v => \`<option value="\${esc(v)}">\`).join("")}</datalist>
  <datalist id="syn-level">\${opt.levels.map(v => \`<option value="\${esc(v)}">\`).join("")}</datalist>
  <datalist id="syn-hand">\${opt.hands.map(v => \`<option value="\${esc(v)}">\`).join("")}</datalist>
  \${Object.keys(opt.tag_categories).map(cat => \`<datalist id="syn-tags-\${cat}">\${opt.tags.filter(t => t.category === cat).map(t => \`<option value="\${esc(t.name)}">\`).join("")}</datalist>\`).join("")}\`;

/* ------------------------------------------------------------------ 4 dialogs */
const MS_FORM = [   // [field, label, wide]
  ["siglum", "Sigle", false], ["shelfmark", "Signatur", false], ["city", "Ort", false], ["library", "Bibliothek", false],
  ["origin", "Herkunft", true], ["date_text", "Datierung", false], ["century_text", "Jahrhundert (z. B. 9, 9-10)", false],
  ["musica_folios", "Folien der Musica", false], ["completeness", "Vollständigkeit", false],
  ["link_text", "Digitalisat (Webadresse; ark:/12148/... für Gallica)", true], ["iiif_manifest", "IIIF-Manifest-Adresse", true]];

/* Form for the details of a manuscript. \`row\` is null for a new manuscript. \`done(saved)\` runs after saving. */
function manuscriptDialog(row, done) {
  const dlg = $("#dialog"), v = row || {};
  dlg.innerHTML = \`<div class="row"><h1 style="margin:0">\${row ? esc(row.siglum) + " bearbeiten" : "Handschrift hinzufügen"}</h1><span style="flex:1"></span><button id="close" type="button">Abbrechen</button></div>
    <form id="ms-edit" class="form-grid">\${MS_FORM.map(([k, label, wide]) => \`<label class="field \${wide ? "wide" : ""}">\${esc(label)}<input name="\${k}" value="\${esc(v[k] ?? "")}" \${k === "siglum" ? "required" : ""}></label>\`).join("")}
      <div class="wide row"><button class="primary">\${row ? "Speichern" : "Handschrift hinzufügen"}</button><span class="muted small">Die Jahrhunderte werden aus dem Jahrhundert-Text gelesen; die Webadresse des Digitalisats ist die erste Adresse im Link-Feld.</span></div></form>\`;
  $("#close").onclick = () => dlg.close();
  $("#ms-edit").onsubmit = guard(async e => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    const saved = await api(row ? \`/synopsis/manuscripts/\${row.id}\` : "/synopsis/manuscripts", { method: row ? "PATCH" : "POST", body });
    dlg.close(); done(saved);
  });
  dlg.showModal();
}

/* The image files of a clipboard or a drop (a screenshot of a crop is a PNG file in the clipboard). */
const imagesIn = data => [...((data && data.files) || [])].filter(f => f.type.startsWith("image/"));

/* Form for a new diagram in a manuscript. Images are optional (a diagram known to be absent has none). They can be pasted
   (Ctrl+V or Cmd+V, for example a screenshot of the crop), dropped on the window, or chosen; several images are the parts
   of one diagram, in the order they were added. o.files: images to start with; o.locus: the locus to preselect. */
function itemDialog(ms, opt, done, o = {}) {
  const dlg = $("#dialog");
  const staged = [...(o.files || [])];
  dlg.innerHTML = \`<div class="row"><h1 style="margin:0">Diagramm zu \${esc(ms.siglum)} hinzufügen</h1><span style="flex:1"></span><button class="primary" form="item-new">Hinzufügen</button><button id="close" type="button">Abbrechen</button></div>
    <form id="item-new" class="form-grid">
      <div class="field wide"><span class="small">Bild</span>
        <div class="paste-zone" id="zone" tabindex="0">
          <div class="staged" id="staged"></div>
          <div class="muted small" id="zone-hint"></div>
          <input type="file" id="picker" accept="image/*" multiple hidden>
        </div></div>
      <label class="field">Diagrammstelle<select name="locus" required><option value="">wählen …</option>\${opt.loci.map(l => \`<option value="\${esc(l.code)}" \${l.code === o.locus ? "selected" : ""}>\${esc(l.code)}\${l.chapter ? " · Kap. " + l.chapter : ""} · \${esc(friedlein(l))}</option>\`).join("")}</select></label>
      <label class="field">Folio oder Seite<input name="folio" placeholder="z. B. 93v"></label>
      <label class="field">Platz auf der Seite<input name="layout_place" placeholder="1, 2, 3 …"></label>
      <label class="field">Status<select name="status"><option value="present">Diagramm vorhanden</option><option value="absent">kein Diagramm in dieser Handschrift (geprüft)</option><option value="erased-layer">getilgte frühere Schicht</option></select></label>
      <label class="field">Schema<input name="schema_value" list="syn-schema" size="5"></label>
      <label class="field">Differenzierungsebene<input name="level_value" list="syn-level" size="5"></label>
      <label class="field"><span><input type="checkbox" name="schema_uncertain" value="true"> Schema unsicher</span></label>
      <label class="field"><span><input type="checkbox" name="level_uncertain" value="true"> Ebene unsicher</span></label>
      <label class="field">Hand (Schreiber oder Schicht)<input name="hand" list="syn-hand" placeholder="z. B. A, B, spätere Hand"></label>
      <label class="field">Bildquelle<select name="image_source"><option value="">nicht angegeben</option><option value="library">Bibliotheksbild</option><option value="private-photo">privates Foto</option></select></label>
      <label class="field wide">Kommentar<textarea name="comment" rows="2"></textarea></label>
      <div class="wide row"><button class="primary">Hinzufügen</button><span class="muted small">Ohne Bild wird das Diagramm ohne Abbildung erfasst.</span></div></form>\`;
  const renderStaged = () => {
    $("#staged").innerHTML = staged.map((f, i) => {
      f.preview = f.preview || URL.createObjectURL(f);
      return \`<figure class="staged-img"><img src="\${f.preview}" alt=""><button type="button" class="link danger" data-rm="\${i}" title="Dieses Bild entfernen">× entfernen</button>
        <figcaption class="small muted">\${staged.length > 1 ? "Teil " + (i + 1) : "Bild"}</figcaption></figure>\`;
    }).join("");
    $("#zone-hint").innerHTML = staged.length
      ? 'Weitere Bilder einfügen oder hineinziehen, um Teile desselben Diagramms zu ergänzen, oder <button type="button" class="link" id="choose">Dateien wählen</button>.'
      : 'Ein Bild hier einfügen (<strong>Strg+V</strong> oder <strong>Cmd+V</strong>, zum Beispiel ein Screenshot des Ausschnitts), Bilddateien hineinziehen oder <button type="button" class="link" id="choose">Dateien wählen</button>.';
    $("#choose").onclick = () => $("#picker").click();
  };
  const addFiles = files => { if (files.length) { staged.push(...files); renderStaged(); } };
  $("#staged").onclick = e => { const i = e.target.dataset.rm; if (i !== undefined) { staged.splice(+i, 1); renderStaged(); } };
  $("#picker").onchange = e => { addFiles([...e.target.files]); e.target.value = ""; };
  dlg.onpaste = e => { const files = imagesIn(e.clipboardData); if (files.length) { e.preventDefault(); addFiles(files); } };
  dlg.ondragover = e => { if ([...(e.dataTransfer?.types || [])].includes("Files")) e.preventDefault(); };
  dlg.ondrop = e => { const files = imagesIn(e.dataTransfer); if (files.length) { e.preventDefault(); addFiles(files); } };
  dlg.addEventListener("close", () => { dlg.onpaste = dlg.ondragover = dlg.ondrop = null; staged.forEach(f => f.preview && URL.revokeObjectURL(f.preview)); }, { once: true });
  renderStaged();
  $("#close").onclick = () => dlg.close();
  $("#item-new").onsubmit = guard(async e => {
    e.preventDefault();
    const form = new FormData(e.target);
    ["schema_uncertain", "level_uncertain"].forEach(k => { if (!form.has(k)) form.set(k, "false"); });
    staged.forEach(f => form.append("files", f, f.name || "image.png"));
    const added = await api(\`/synopsis/manuscripts/\${ms.id}/items\`, { method: "POST", form });
    dlg.close(); done(added);
  });
  dlg.showModal();
  (o.files && o.files.length ? $("#item-new [name=locus]") : $("#zone")).focus();
}

/* Links to the pages of a manuscript in the library's viewer, worked out from the folios (see synopsis_pages.py). */
function pageLinksDialog(ms, done) {
  const dlg = $("#dialog");
  const guess = /gallica\\.bnf\\.fr\\/ark:/.test(ms.source_url || "") ? ms.source_url.replace(/\\/+$/, "") + "/f{n}.item" : "";
  dlg.innerHTML = \`<div class="row"><h1 style="margin:0">Seitenlinks für \${esc(ms.siglum)}</h1><span style="flex:1"></span><button id="close" type="button">Schließen</button></div>
    <p class="small muted">Ein Viewer spricht eine Seite über die Nummer ihres Bildes im Digitalisat an. Die Adresse einer Seite angeben, mit <code>{n}</code> an der Stelle der Nummer, dazu die Nummer des Bildes, das das erste Folio (recto) zeigt. Das Programm rechnet die Nummer für jedes Folio aus, zeigt die Links und speichert sie mit dem zweiten Knopf. Vorher ein, zwei Links öffnen und prüfen, ob der Viewer das richtige Folio zeigt; sonst die Nummer des ersten Bildes ändern.</p>
    <form id="pl-form" class="form-grid">
      <label class="field wide">Adresse mit {n}<input name="template" value="\${esc(guess)}" placeholder="https://gallica.bnf.fr/ark:/12148/…/f{n}.item"></label>
      <label class="field">Nummer des ersten Bildes (Folio 1 recto oder Seite 1)<input name="first_image" type="number" min="1" value="1"></label>
      <label class="field">Der Viewer zählt<select name="mode"><option value="folio">Folien (recto und verso sind zwei Bilder)</option><option value="page">Seiten (ein Bild je Seite)</option></select></label>
      <label class="field wide"><span><input type="checkbox" name="overwrite" value="true"> auch bereits vorhandene Links ersetzen</span></label>
      <div class="wide row"><button class="primary">Links anzeigen</button><button type="button" id="pl-apply" disabled>Diese Links speichern</button></div></form>
    <div id="pl-result" class="small"></div>\`;
  const body = preview => { const f = new FormData($("#pl-form")); return { template: f.get("template"), first_image: +f.get("first_image"), mode: f.get("mode"), overwrite: f.get("overwrite") === "true", preview }; };
  $("#close").onclick = () => dlg.close();
  $("#pl-form").onsubmit = guard(async e => {
    e.preventDefault();
    const r = await api(\`/synopsis/manuscripts/\${ms.id}/page-links\`, { method: "POST", body: body(true) });
    const rows = r.entries.filter(x => x.action !== "skip");
    $("#pl-apply").disabled = !r.counts.set;
    $("#pl-result").innerHTML = \`<p>\${r.counts.set} Link(s) würden gespeichert, \${r.counts.keep} vorhandene(r) bleiben, \${r.counts.skip} Folio(s) übersprungen.</p>
      <table class="list"><thead><tr><th>Folio</th><th>Bild</th><th>Link (öffnet den Viewer)</th><th></th></tr></thead><tbody>\${rows.slice(0, 12).map(x =>
        \`<tr><td>\${esc(x.folio)}</td><td>\${x.n}</td><td><a href="\${esc(x.link)}" target="_blank" rel="noopener">\${esc(x.link)}</a></td><td class="muted">\${x.action === "keep" ? "bleibt: hat schon einen Link" : ""}</td></tr>\`).join("")}</tbody></table>
      \${rows.length > 12 ? \`<p class="muted">… und \${rows.length - 12} weitere.</p>\` : ""}
      \${r.counts.skip ? \`<p class="muted">Übersprungen (eingeschobene Blätter, Zusatznummern oder keine Nummer): \${esc(r.entries.filter(x => x.action === "skip").map(x => x.folio || "–").join(", "))}</p>\` : ""}\`;
  });
  $("#pl-apply").onclick = guard(async () => {
    const r = await api(\`/synopsis/manuscripts/\${ms.id}/page-links\`, { method: "POST", body: body(false) });
    dlg.close(); done(r);
  });
  dlg.showModal();
}

/* ------------------------------------------------------------------ 5 pages */
/* ---- the Latin text at a locus (Friedlein's edition, OCR). It is a reference frame: the manuscripts differ from the edition in
   readings, chapter division and the place of diagrams, so the pages never call it the text of a manuscript. */
const TEXT_WARNING = "Friedlein-Text (kritische Ausgabe von 1867, maschinell erkannt, ungeprüft). Handschriften können abweichen.";
const excerptHtml = l => l && l.friedlein_page
  ? \`<details class="syn-excerpt" data-page="\${l.friedlein_page}" data-line="\${l.friedlein_line || 1}"><summary class="small muted">Text bei Friedlein ab S. \${l.friedlein_page}\${l.friedlein_line ? ", Z. " + l.friedlein_line : ""}</summary><div class="excerpt-body small"></div></details>\` : "";
const textLines = (lines, anchor) => lines.map((x, i) => \`\${i === 0 || x.page !== lines[i - 1].page ? \`<div class="muted pg">— Friedlein, Seite \${x.page} —</div>\` : ""}<div class="\${i === anchor ? "anchor" : ""}"\${i === anchor ? ' title="Hier steht die Diagrammstelle (Position aus der Tabelle der Stellen)"' : ""}><span class="ln">\${x.line}</span> \${esc(x.text)}</div>\`).join("");
/* Loads the passage when an excerpt is opened for the first time: 8 lines before the diagram's position and 30 after, in a box that
   scrolls; "weiter oben" and "weiter unten" load 20 more lines at that end. The line of the position is marked. */
function bindExcerpts(root) {
  root.addEventListener("toggle", async e => {
    const d = e.target;
    if (!d.classList || !d.classList.contains("syn-excerpt") || !d.open || d.dataset.loaded) return;
    d.dataset.loaded = "1"; d.dataset.before = "8"; d.dataset.after = "30";
    await loadExcerpt(d);
  }, true);
  root.addEventListener("click", async e => {
    const more = e.target.dataset && e.target.dataset.more, d = e.target.closest && e.target.closest(".syn-excerpt");
    if (!more || !d) return;
    e.preventDefault();
    d.dataset[more === "up" ? "before" : "after"] = String(+d.dataset[more === "up" ? "before" : "after"] + 20);
    await loadExcerpt(d, more);
  });
}
async function loadExcerpt(d, keep) {
  const body = d.querySelector(".excerpt-body");
  try {
    const r = await api(\`/synopsis/text/passage?page=\${d.dataset.page}&line=\${d.dataset.line}&lines=\${d.dataset.after}&before=\${d.dataset.before}\`);
    const top = body.scrollTop, height = body.scrollHeight;
    body.innerHTML = \`<p class="muted" style="margin:2px 0">\${esc(TEXT_WARNING)}</p><button class="link" data-more="up">▲ weiter oben</button>
      <div class="excerpt-text">\${textLines(r.lines, r.anchor)}</div><button class="link" data-more="down">▼ weiter unten</button>\`;
    if (keep === "up") body.scrollTop = top + (body.scrollHeight - height);
    else if (keep === "down") body.scrollTop = top;
    else { const mark = body.querySelector(".anchor"); if (mark) body.scrollTop = Math.max(0, mark.offsetTop - 60); }
  } catch (err) { body.textContent = "Text nicht verfügbar."; }
}

/* ---- start page */
async function synopsisStart() {
  const [opt, views] = await Promise.all([api("/synopsis/options"), api("/synopsis/views")]);
  const total = opt.manuscripts.reduce((n, m) => n + m.item_count, 0), withItems = opt.manuscripts.filter(m => m.item_count).length;
  view.innerHTML = \`\${synNav("")}
    <h1 class="start-title">A. M. S. Boethius: <em>De institutione musica</em><br>Handschriftliche Überlieferung der Diagramme, Buch III</h1>
    <p class="muted">\${total} Diagramme in \${withItems} Handschriften an \${opt.loci.length} Diagrammstellen.</p>
    <div class="entry-grid">
      <a class="entry" href="#/synopsis/manuscripts"><h2>Handschriften</h2><p>Tabelle der Handschriften. Mehrere ankreuzen: Synopsen-Ansicht. Eine auswählen: alle Diagramme dieser Handschrift.</p></a>
      <a class="entry" href="#/synopsis/select"><h2>Item-Auswahl nach Buchstruktur</h2><p>Diagrammstellen nach Buch und Kapitel wählen und die Synopsen-Ansicht erstellen.</p></a>
      <a class="entry" href="#/synopsis/search"><h2>Stichwortsuche</h2><p>Wörter in Kommentaren, Händen und Schlagwörtern (Tags) suchen.</p></a>
    </div>
    \${views.length ? \`<p class="small"><strong>Gespeicherte Ansichten:</strong> \${views.map(v => \`<a class="chip filter" href="#/synopsis/view\${v.query ? "?" + v.query : ""}">\${esc(v.name)}</a>\`).join(" ")}</p>\` : ""}
    <p class="muted small">Alle Änderungen werden sofort gespeichert. Außerdem: <a href="#/synopsis/history">Verlauf und Rückgängig</a> · <a href="#/synopsis/stats">Statistik</a> · <a href="#/synopsis/overview">Überblick (Schemata je Handschrift und Stelle)</a> · <a href="#/synopsis/tags">Tags verwalten</a> ·
      <a href="/api/synopsis/backup.zip" download data-download="backup">Backup aller Daten und Bilder</a> (gelegentlich machen und sicher ablegen) · <a href="/api/synopsis/export.xlsx" download data-download="xlsx">Excel-Export</a> im Layout der Original-Tabelle.</p>\`;
}

/* ---- Item-Auswahl nach Buchstruktur: choose loci by book and chapter, then build the synopsis */
async function synopsisSelect() {
  const opt = await api("/synopsis/options");
  let chosen = [];
  view.innerHTML = \`\${synNav("select")}
    <h1>Item-Auswahl nach Buchstruktur</h1>
    <p class="muted small">Diagrammstellen anklicken (ein Kapitel-Etikett wählt alle Stellen des Kapitels). Die Zahl ist die Menge der Diagramme an der Stelle.</p>
    <div id="strip" class="strip-bar"></div>
    <p><button class="primary" id="build" disabled>Synopsen-Ansicht erstellen</button> <span class="muted small" id="n"></span></p>\`;
  const draw = () => {
    $("#strip").innerHTML = \`<button class="chip filter \${chosen.length ? "" : "on"}" data-all>alle Stellen</button>\` + locusStrip(opt.loci, chosen);
    $("#build").textContent = chosen.length ? \`Synopsen-Ansicht erstellen (\${chosen.length} Stelle\${chosen.length > 1 ? "n" : ""})\` : "Synopsen-Ansicht aller Stellen erstellen";
    $("#build").disabled = false;
  };
  bindStrip($("#strip"), () => chosen, sel => { chosen = sel; draw(); });
  $("#build").onclick = () => { location.hash = synHash("view", { locus: chosen }); };
  draw();
}

/* ---- Stichwortsuche */
async function synopsisSearch() {
  const opt = await api("/synopsis/options");
  const tagGroups = Object.entries(opt.tag_categories).map(([cat, name]) => {
    const tags = opt.tags.filter(t => t.category === cat).sort((a, b) => b.count - a.count).slice(0, 30);
    return tags.length ? \`<div class="tag-row"><span class="tag-cat">\${esc(name)}</span>\${tags.map(t => \`<a class="chip filter" href="\${synHash("view", { tag: [String(t.id)] })}">\${esc(t.name)} <small>\${t.count}</small></a>\`).join("")}</div>\` : "";
  }).join("");
  view.innerHTML = \`\${synNav("")}
    <h1>Stichwortsuche</h1>
    <p class="muted small">Gesucht wird in Kommentaren, Händen, Anmerkungen und Tags; die Treffer erscheinen in der Synopsen-Ansicht. Tags (Kapitelinhalt, Diagramminhalt, grafische Elemente) werden in den Details eines Diagramms vergeben.</p>
    <form id="kw-form" class="row"><input id="kw" placeholder="z. B. Monochord, Bögen, spätere Hand" size="36" autofocus><button class="primary">Suchen</button></form>
    \${tagGroups || '<p class="muted small">Noch keine Tags.</p>'}
    <h2>Suche im Text (Boethius, Buch III)</h2>
    <p class="muted small">\${esc(TEXT_WARNING)} Die Schreibweise u/v und i/j ist egal. Ein Treffer gehört zu keiner Handschrift: genannt werden nur die Diagrammstellen davor und danach in Friedleins Anordnung.</p>
    <form id="tx-form" class="row"><input id="tx" placeholder="z. B. diatessaron duobus tonis" size="36"><button class="primary">Im Text suchen</button></form>
    <div id="tx-result"></div>\`;
  $("#kw-form").onsubmit = e => { e.preventDefault(); const q = $("#kw").value.trim(); if (q) location.hash = synHash("view", { q }); };
  const near = (l, word) => l ? \`\${word}: <a href="\${synHash("view", { locus: [l.code] })}">\${esc(l.code)}</a> (S. \${l.page}, Z. \${l.line}; \${l.item_count} Diagramme)\` : "";
  $("#tx-form").onsubmit = guard(async e => {
    e.preventDefault();
    const q = $("#tx").value.trim(); if (q.length < 2) return;
    const r = await api(\`/synopsis/text/search?q=\${encodeURIComponent(q)}\`);
    $("#tx-result").innerHTML = r.hits.length ? \`<p class="small">\${r.hits.length} Stelle(n)\${r.hits.length >= 60 ? " (die ersten 60)" : ""}</p>\` + r.hits.map(h => \`<div class="tx-hit"><strong>S. \${h.page}, Z. \${h.line}</strong> <span class="muted small">\${[near(h.before, "davor"), near(h.after, "danach")].filter(Boolean).join(" · ")}</span><div>\${esc(h.text)}</div></div>\`).join("")
      : '<p class="muted">Nichts gefunden. Die maschinelle Texterkennung liest manche Wörter falsch; mit einem kürzeren Wortteil suchen.</p>';
  });
}

/* ---- manuscript table */
async function synopsisManuscripts(params) {
  let rows = await api("/synopsis/manuscripts");
  let onlyItems = true, text = "";
  const ticked = new Set();
  view.innerHTML = \`\${synNav("manuscripts")}
    <h1>Handschriften</h1>
    <p class="muted small">Sigle anklicken: alle Diagramme dieser Handschrift. Mehrere ankreuzen: Synopsen-Ansicht. Eine ankreuzen: Ansicht dieser Handschrift. „bearbeiten“ ändert die Angaben zur Handschrift.</p>
    <div class="filters">
      <input id="mq" placeholder="Filter (Sigle, Ort, Herkunft, Datierung)" size="32">
      <label><input type="checkbox" id="only" checked> nur Handschriften mit Diagrammen</label>
      <button id="add">Handschrift hinzufügen</button>
      <span style="flex:1"></span>
      <button class="primary" id="go" disabled>Ansicht öffnen</button>
    </div>
    <p class="muted small" id="count"></p>
    <div class="ed-wrap"><table class="list" id="mtable"></table></div>\`;
  const draw = () => {
    const shown = rows.filter(r => (!onlyItems || r.item_count) &&
      (!text || [r.siglum, r.city, r.library, r.shelfmark, r.origin, r.date_text].join(" ").toLowerCase().includes(text)));
    $("#count").textContent = \`\${shown.length} von \${rows.length} Handschriften\`;
    $("#mtable").innerHTML = \`<thead><tr><th></th><th>Sigle</th><th>Bibliothek</th><th>Herkunft</th><th>Datierung</th><th>Jahrhundert</th><th>Musica</th><th>Diagramme</th><th>Digitalisat</th><th></th></tr></thead><tbody>\` +
      shown.map(r => \`<tr><td><input type="checkbox" data-sig="\${esc(r.siglum)}" \${ticked.has(r.siglum) ? "checked" : ""} \${r.item_count ? "" : "disabled"}></td>
        <td><a href="#/synopsis/manuscript?id=\${r.id}"><strong>\${esc(r.siglum)}</strong></a>\${r.completeness ? \`<br><small class="muted">\${esc(r.completeness)}</small>\` : ""}</td>
        <td>\${esc(r.city)}\${r.library ? ", " + esc(r.library) : ""}<br><small class="muted">\${esc(r.shelfmark)}</small></td>
        <td>\${esc(r.origin)}</td><td>\${esc(r.date_text)}</td><td>\${esc(r.century_text)}</td><td>\${esc(r.musica_folios)}</td>
        <td>\${r.item_count ? \`<a href="#/synopsis/manuscript?id=\${r.id}">\${r.item_count}</a>\` : '<span class="muted">0</span>'}</td>
        <td>\${r.source_url ? \`<a href="\${esc(r.source_url)}" target="_blank" rel="noopener">öffnen</a>\` : \`<small class="muted">\${esc(r.link_text)}</small>\`}</td>
        <td><button class="link" data-edit="\${r.id}">bearbeiten</button></td></tr>\`).join("") + "</tbody>";
    goLabel();
  };
  const goLabel = () => { $("#go").disabled = !ticked.size; $("#go").textContent = ticked.size > 1 ? \`Synopsen-Ansicht (\${ticked.size} Handschriften)\` : ticked.size === 1 ? "Diagramme dieser Handschrift" : "Ansicht öffnen"; };
  const edit = row => manuscriptDialog(row, async () => { rows = await api("/synopsis/manuscripts"); draw(); });
  $("#mq").oninput = e => { text = e.target.value.trim().toLowerCase(); draw(); };
  $("#only").onchange = e => { onlyItems = e.target.checked; draw(); };
  $("#add").onclick = () => { onlyItems = false; $("#only").checked = false; edit(null); };
  $("#mtable").onchange = e => { const s = e.target.dataset.sig; if (s) { e.target.checked ? ticked.add(s) : ticked.delete(s); goLabel(); } };
  $("#mtable").onclick = e => { const id = e.target.dataset.edit; if (id) edit(rows.find(r => r.id === +id)); };
  $("#go").onclick = () => {
    const one = ticked.size === 1 ? rows.find(r => r.siglum === [...ticked][0]) : null;
    location.hash = one ? \`#/synopsis/manuscript?id=\${one.id}\` : synHash("view", { siglum: [...ticked] });
  };
  draw();
  const open = rows.find(r => r.id === +params.get("edit"));
  if (open) edit(open);
}

/* ---- the diagrams of one manuscript */
async function synopsisManuscript(params) {
  const id = +params.get("id");
  const [opt, ms, rows] = await Promise.all([api("/synopsis/options"), api(\`/synopsis/manuscripts/\${id}\`), api("/synopsis/manuscripts")]);
  const list = rows.filter(r => r.item_count || r.id === id);   // the order of the manuscript table
  const at = list.findIndex(r => r.id === id), prev = list[at - 1], next = list[at + 1];
  const f = readFilters(params, MS_FILTERS);
  const ui = { ...readLayout(params, 200), showHidden: params.get("hidden") === "1" };
  const cardOptions = { siglum: false, hide: true, del: true };
  const ctl = { data: { groups: [] }, all: { groups: [] }, cardOptions, loci: opt.loci, opt };
  const goTo = r => \`#/synopsis/manuscript?id=\${r.id}\`;

  const meta = [["Bibliothek", [ms.city, ms.library].filter(Boolean).join(", ")], ["Signatur", ms.shelfmark], ["Herkunft", ms.origin], ["Datierung", ms.date_text],
    ["Jahrhundert", ms.century_text], ["Folien der Musica", ms.musica_folios], ["Vollständigkeit", ms.completeness]].filter(([, v]) => v);
  view.innerHTML = \`\${synNav("manuscripts")}
    <div class="row ms-nav">
      <a href="#/synopsis/manuscripts">← alle Handschriften</a>
      \${prev ? \`<a href="\${goTo(prev)}" title="Vorherige Handschrift der Tabelle">‹ \${esc(prev.siglum)}</a>\` : ""}
      <select id="jump" title="Zu einer anderen Handschrift">\${list.map(r => \`<option value="\${r.id}" \${r.id === id ? "selected" : ""}>\${esc(r.siglum)}</option>\`).join("")}</select>
      \${next ? \`<a href="\${goTo(next)}" title="Nächste Handschrift der Tabelle">\${esc(next.siglum)} ›</a>\` : ""}
      <span style="flex:1"></span>
      <a class="btn" href="\${synHash("view", { siglum: [ms.siglum] })}">Mit anderen Handschriften vergleichen</a></div>
    <div class="ms-layout">
      <div class="ms-main">
        <div class="syn-head">
          <div class="syn-head-row"><h1>\${esc(ms.siglum)}</h1><div class="filters" id="fbar"></div></div>
          <div class="syn-head-row syn-head-tools">
            <button id="add-item">Diagramm hinzufügen</button><span class="muted small syn-intro">oder ein Bild hier einfügen (Strg+V / Cmd+V)</span>
            <label><input type="checkbox" id="show-hidden" \${ui.showHidden ? "checked" : ""}> ausgeblendete anzeigen <span id="hidden-n" class="muted"></span></label>
            \${layoutHtml()}
            <button id="page-links" title="Links zu den Seiten im Viewer der Bibliothek aus den Folien berechnen">Seitenlinks</button>
            <span class="muted small" id="count"></span>
          </div>
        </div>
        \${classDatalists(opt)}
        <div id="groups"></div>
      </div>
      <aside class="ms-box"><h2>Metadaten Handschrift:</h2>
        <dl>\${meta.map(([k, v]) => \`<dt>\${esc(k)}</dt><dd>\${esc(v)}</dd>\`).join("")}
          <dt>Digitalisat</dt><dd>\${ms.source_url ? \`<a href="\${esc(ms.source_url)}" target="_blank" rel="noopener">ganze Handschrift öffnen ↗</a>\` : esc(ms.link_text) || '<span class="muted">keines</span>'}</dd></dl>
        <p class="small"><a href="#/synopsis/manuscripts?edit=\${ms.id}">Angaben in der Handschriften-Tabelle bearbeiten</a></p></aside>
    </div>\`;

  const url = () => synHash("manuscript", f, { id, ...layoutParams(ui, 200), hidden: ui.showHidden ? "1" : "" }, MS_FILTERS);
  const lists = () => {
    const loci = ctl.all.groups.filter(g => g.locus).map(g => g.locus);
    const inScope = l => (!f.book.length || f.book.includes(l.book)) && (!f.chapter.length || f.chapter.includes(String(l.chapter)));
    return {
      book: ["Buch (I, II, III, IV, V)", [...new Set(loci.map(l => l.book).filter(Boolean))].map(b => ({ value: b, label: b }))],
      chapter: ["Kapitel (1–16)", [...new Set(loci.filter(l => !f.book.length || f.book.includes(l.book)).map(l => l.chapter).filter(c => c != null))].sort((x, y) => x - y).map(c => ({ value: String(c), label: String(c) }))],
      locus: ["Diagrammstelle", loci.filter(inScope).map(l => ({ value: l.code, label: l.code, count: ctl.all.groups.find(g => g.locus?.code === l.code).items.length }))],
    };
  };
  const drawBar = () => {
    const L = lists();
    $("#fbar").innerHTML = MS_FILTERS.map(k => pickHtml(k, L[k][0], L[k][1], f[k].map(String))).join("") + (MS_FILTERS.some(k => f[k].length) ? '<button class="link" id="clear-all">zurücksetzen</button>' : "");
    const c = $("#clear-all"); if (c) c.onclick = () => { MS_FILTERS.forEach(k => f[k] = []); history.replaceState(null, "", url()); drawBar(); render(); };
  };
  bindPicks($("#fbar"), f, () => { history.replaceState(null, "", url()); drawBar(); render(); });
  $("#jump").onchange = e => { location.hash = \`#/synopsis/manuscript?id=\${e.target.value}\`; };

  /* The page keeps every group of the manuscript (ctl.all) and filters on the client; a manuscript has few diagrams. */
  async function load(focusId) {
    ctl.all = await api(\`/synopsis/items?manuscript=\${id}\`);
    drawBar(); render();
    if (focusId) { const c = view.querySelector(\`.syn-card[data-id="\${focusId}"]\`); if (c) { c.scrollIntoView({ block: "center" }); c.classList.add("just-added"); } }
  }
  function render() {
    const groups = ctl.all.groups.filter(g => (!f.locus.length || f.locus.includes(g.locus?.code))
      && (!f.book.length || f.book.includes(g.locus?.book)) && (!f.chapter.length || f.chapter.includes(String(g.locus?.chapter))));
    ctl.data = { groups };
    const hidden = new Set(groups.flatMap(g => g.items).filter(i => i.hidden).map(i => i.id));
    $("#hidden-n").textContent = hidden.size ? \`(\${hidden.size})\` : "";
    const shown = g => g.items.filter(i => ui.showHidden || !i.hidden);
    const visible = new Set(groups.flatMap(shown).map(i => i.id));
    $("#count").textContent = \`\${visible.size} Diagramme angezeigt\`;
    $("#groups").innerHTML = visible.size ? \`<div class="syn-body">\${groups.filter(g => shown(g).length).map(g => \`<div class="syn-block">
      <h3 class="syn-sub">\${g.locus ? esc(g.locus.code) + \` <span class="muted">\${esc(locusLine(g.locus))}</span>\` : "ohne Diagrammstelle"}</h3>\${excerptHtml(g.locus)}
      <div class="syn-row">\${shown(g).map(it => synCard(it, { ...cardOptions, group: g.locus?.code, locus: g.locus })).join("")}</div></div>\`).join("")}</div>\`
      : '<p class="muted">Kein Diagramm zum Anzeigen.</p>';
  }
  ctl.redraw = render; ctl.reload = () => load();
  ctl.afterSave = async () => { Object.assign(opt, await api("/synopsis/options")); updateDatalists(opt); };
  bindCards($("#groups"), ctl);
  bindExcerpts($("#groups"));
  bindLayout(ui, $("#groups"), () => history.replaceState(null, "", url()));
  $("#show-hidden").onchange = e => { ui.showHidden = e.target.checked; history.replaceState(null, "", url()); render(); };
  const addDiagram = files => itemDialog(ms, opt, added => load(added.id), { files, locus: f.locus.length === 1 ? f.locus[0] : "" });
  $("#add-item").onclick = () => addDiagram([]);
  $("#page-links").onclick = () => pageLinksDialog(ms, result => { toast(\`\${result.changed} page link(s) stored\`); load(); });
  // Paste or drop an image anywhere on this page: the form opens with it (the handlers check that this page is still shown)
  if (synopsisManuscript.onPaste) document.removeEventListener("paste", synopsisManuscript.onPaste);
  synopsisManuscript.onPaste = e => {
    if (parseHash().arg !== "manuscript" || $("#dialog").open) return;
    const files = imagesIn(e.clipboardData);
    if (files.length) { e.preventDefault(); addDiagram(files); }
  };
  document.addEventListener("paste", synopsisManuscript.onPaste);
  const filesDragged = e => [...(e.dataTransfer?.types || [])].includes("Files");
  view.ondragover = e => { if (parseHash().arg === "manuscript" && filesDragged(e)) e.preventDefault(); };
  view.ondrop = e => {
    if (parseHash().arg !== "manuscript" || $("#dialog").open) return;
    const files = imagesIn(e.dataTransfer);
    if (files.length) { e.preventDefault(); addDiagram(files); }
  };
  await load();
  trackStickyHeights();
}

/* ---- synopsis: diagrams of several manuscripts side by side */
const romanOrder = s => ({ I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6 }[s] ?? (s ? 50 : 100));   // empty value sorts last
const minCentury = it => it.centuries.length ? Math.min(...it.centuries) : 99;

function sortItems(items, mode) {
  const tail = (a, b) => a.siglum.localeCompare(b.siglum) || (a.folio_sort ?? 1e9) - (b.folio_sort ?? 1e9) || a.layout_place.localeCompare(b.layout_place) || a.id - b.id;
  const byManuscript = (a, b) => minCentury(a) - minCentury(b) || tail(a, b);
  const absentLast = (a, b) => (a.status === "absent") - (b.status === "absent");
  if (mode === "manuscript") return [...items].sort((a, b) => absentLast(a, b) || byManuscript(a, b));
  return [...items].sort((a, b) => absentLast(a, b) || romanOrder(a.schema_value) - romanOrder(b.schema_value) || a.schema_value.localeCompare(b.schema_value)
    || a.schema_uncertain - b.schema_uncertain || (a.level_value || "~").localeCompare(b.level_value || "~") || byManuscript(a, b));
}

async function synopsisView(params) {
  const opt = await api("/synopsis/options");
  const f = readFilters(params, SYN_FILTERS);
  f.q = params.get("q") || "";
  const ui = { order: params.get("order") || "schema", ...readLayout(params, 220) };
  const cardOptions = { siglum: true };
  const ctl = { data: { groups: [] }, cardOptions, loci: opt.loci, opt };

  view.innerHTML = \`\${synNav("view")}
    <div class="syn-head">
      <div class="syn-head-row"><h1>Synopsen-Ansicht</h1><div class="filters" id="fbar"></div></div>
      <div class="active-filters" id="active"></div>
      <div class="syn-head-row syn-head-tools">
        \${layoutHtml()}
        <details class="more-filters"\${MORE_PICKS.some(k => f[k].length) || f.q ? " open" : ""}><summary>Weitere Filter, Suche, Reihenfolge</summary>
          <div class="more-body"><div class="filters" id="fbar2"></div>
            <input id="q" placeholder="Suche in Kommentar, Hand, Sigle, Folio" value="\${esc(f.q)}" size="28">
            <label>Reihenfolge innerhalb einer Stelle <select id="order"><option value="schema">nach Schema, Ebene, Handschrift</option><option value="manuscript">nach Handschrift (Jahrhundert)</option></select></label>
            <button class="link" id="resort" title="Geänderte Karten behalten ihren Platz, bis neu sortiert wird">jetzt neu sortieren</button></div></details>
        <span class="muted small" id="count"></span><span style="flex:1"></span>
        <select id="views" title="Gespeicherte Ansichten"></select><button id="view-save" title="Die aktuellen Filter und das Layout unter einem Namen speichern">Ansicht speichern</button><button id="view-del" class="link danger" hidden>löschen</button>
      </div>
    </div>
    \${classDatalists(opt)}
    <div id="groups"></div>\`;
  $("#order").value = ui.order;
  let saved = await api("/synopsis/views");
  const drawViews = selectedId => {
    $("#views").innerHTML = \`<option value="">Gespeicherte Ansichten …</option>\` + saved.map(v => \`<option value="\${v.id}" \${String(v.id) === String(selectedId) ? "selected" : ""}>\${esc(v.name)}</option>\`).join("");
    $("#view-del").hidden = !selectedId;
  };
  drawViews();
  $("#views").onchange = e => { const v = saved.find(x => String(x.id) === e.target.value); if (v) location.hash = \`#/synopsis/view\${v.query ? "?" + v.query : ""}\`; else drawViews(); };
  $("#view-save").onclick = async () => {
    const name = prompt("Name für diese Ansicht:"); if (!name || !name.trim()) return;
    saved = await api("/synopsis/views", { method: "PUT", body: { name, query: location.hash.split("?")[1] || "" } });
    drawViews(saved.find(v => v.name.toLowerCase() === name.trim().toLowerCase())?.id); toast(\`Ansicht „\${name.trim()}“ gespeichert\`);
  };
  $("#view-del").onclick = async () => {
    const id = $("#views").value; if (!id || !confirm("Diese gespeicherte Ansicht löschen? (Die Diagramme bleiben.)")) return;
    saved = await api(\`/synopsis/views/\${id}\`, { method: "DELETE" }); drawViews();
  };
  $("#views").addEventListener("change", () => { $("#view-del").hidden = !$("#views").value; });

  const buildLists = () => ({
    locus: ["Diagrammstelle", opt.loci.map(l => ({ value: l.code, label: l.chapter ? \`\${l.code} · Kap. \${l.chapter}\` : l.code, count: l.item_count }))],
    siglum: ["Handschrift (Sigle)", opt.manuscripts.map(m => ({ value: m.siglum, label: m.siglum, count: m.item_count }))],
    century: ["Jahrhundert", opt.centuries.map(c => ({ value: c, label: \`\${c}. Jh.\` }))],
    origin: ["Herkunftsort", opt.origins.map(o => ({ value: o, label: o.length > 60 ? o.slice(0, 58) + "…" : o }))],
    schema: ["Schema", [...opt.schemas.map(v => ({ value: v, label: v })), { value: SYN_NONE, label: "(keines)" }]],
    level: ["Differenzierungsebene", [...opt.levels.map(v => ({ value: v, label: v })), { value: SYN_NONE, label: "(keine)" }]],
    hand: ["Hand", [...opt.hands.map(v => ({ value: v, label: v })), { value: SYN_NONE, label: "(keine)" }]],
    tag: ["Tag", opt.tags.map(t => ({ value: String(t.id), label: \`\${opt.tag_categories[t.category]}: \${t.name}\`, count: t.count }))],
    source: ["Bildquelle", [{ value: "library", label: "Bibliotheksbild" }, { value: "private-photo", label: "privates Foto" }, { value: SYN_NONE, label: "(nicht angegeben)" }]],
  });
  let optionLists = buildLists();
  ctl.afterSave = async () => { Object.assign(opt, await api("/synopsis/options")); optionLists = buildLists(); updateDatalists(opt); drawBar(); };
  const drawBar = () => {
    const picks = keys => keys.map(k => pickHtml(k, optionLists[k][0], optionLists[k][1], f[k].map(String))).join("");
    $("#fbar").innerHTML = picks(MAIN_PICKS) + (SYN_FILTERS.some(k => f[k].length) || f.q ? '<button class="link" id="clear-all">alle zurücksetzen</button>' : "");
    $("#fbar2").innerHTML = picks(MORE_PICKS);
    const c = $("#clear-all"); if (c) c.onclick = () => { SYN_FILTERS.forEach(k => f[k] = []); f.q = ""; $("#q").value = ""; sync(true); };
    // every active filter as a chip that removes it
    $("#active").innerHTML = SYN_FILTERS.flatMap(k => f[k].map(v => {
      const label = (optionLists[k][1].find(o => String(o.value) === String(v)) || { label: v }).label;
      return \`<button class="chip filter on" data-rm="\${esc(k)}" data-v="\${esc(v)}" title="Filter entfernen">\${esc(optionLists[k][0])}: \${esc(label)} ×</button>\`;
    })).join("");
  };
  const sync = reload => {
    history.replaceState(null, "", synHash("view", f, { order: ui.order !== "schema" ? ui.order : "", ...layoutParams(ui, 220) }));
    drawBar(); if (reload) load(); else render();
  };
  bindPicks($("#fbar"), f, () => sync(true));
  bindPicks($("#fbar2"), f, () => sync(true));
  $("#active").onclick = e => {
    const b = e.target.closest("[data-rm]"); if (!b) return;
    f[b.dataset.rm] = f[b.dataset.rm].filter(v => String(v) !== b.dataset.v); sync(true);
  };
  $("#q").oninput = e => { f.q = e.target.value; clearTimeout(synopsisView.t); synopsisView.t = setTimeout(() => sync(true), 250); };
  $("#order").onchange = e => { ui.order = e.target.value; sync(false); };
  bindLayout(ui, $("#groups"), () => sync(false));
  $("#resort").onclick = () => render();

  async function load() {
    const p = new URLSearchParams(); SYN_FILTERS.forEach(k => f[k].forEach(v => p.append(k, v))); if (f.q) p.set("q", f.q);
    ctl.data = await api("/synopsis/items?" + p.toString());
    render();
  }
  function render() {
    const data = ctl.data;
    $("#count").textContent = data.total ? \`\${data.shown} von \${data.total} Diagrammen\` : "";
    $("#groups").innerHTML = data.groups.map(g => {
      const items = sortItems(g.items, ui.order);
      // Blocks of one schema and level, one below the other inside a locus.
      let body = "", last = null;
      for (const it of items) {
        if (ui.order === "schema") {
          const absent = it.status === "absent";
          const key = absent ? "absent" : it.schema_value ? \`\${it.schema_value}|\${it.schema_uncertain}|\${it.level_value}\` : \`|0|\${it.level_value}\`;   // no schema: one group, however it is flagged
          if (key !== last) {
            last = key; if (body) body += "</div></div>";
            const label = absent ? "Kein Diagramm (geprüft)" : it.schema_value ? \`Schema \${esc(it.schema_value)}\${it.schema_uncertain ? "?" : ""}\` : "Schema nicht zugeordnet";
            const level = !absent && it.level_value ? \` · Ebene \${esc(it.level_value)}\${it.level_uncertain ? "?" : ""}\` : "";
            const attrs = absent || !g.locus ? "" : \` data-drop data-group="\${esc(g.locus.code)}" data-schema="\${esc(it.schema_value)}" data-schema-u="\${it.schema_value && it.schema_uncertain ? 1 : 0}" data-level="\${esc(it.level_value)}" data-level-u="\${it.level_uncertain ? 1 : 0}"\`;
            body += \`<div class="syn-block"\${attrs}><h3 class="syn-sub">\${label}\${level}</h3><div class="syn-row">\`;
          }
        } else if (body === "") body = '<div class="syn-block"><div class="syn-row">';
        body += synCard(it, { ...cardOptions, group: g.locus?.code, locus: g.locus, drag: ui.order === "schema" && !!g.locus && it.status !== "absent" });
      }
      if (body) body += "</div></div>";
      const l = g.locus;
      if (ui.order === "schema" && l && items.length) body += \`<div class="syn-block syn-newblock" data-newschema data-group="\${esc(l.code)}"><h3 class="syn-sub">Neue Schema-Gruppe</h3><div class="syn-drop">Karte hierher ziehen</div></div>\`;
      // "Not checked" is only meaningful when no filter on the diagrams themselves narrows the list.
      const coverage = !f.schema.length && !f.level.length && !f.source.length && !f.q;
      const absent = items.filter(i => i.status === "absent").length, missing = coverage ? g.missing : [];
      return \`<details class="syn-group" open><summary><strong>\${l ? esc(l.code) : "(no locus)"}</strong>
        <span class="muted">\${l ? esc(locusLine(l)) : ""}</span> <span class="chip">\${items.length - absent}</span>
        \${absent ? \`<span class="chip auto" title="Checked: no diagram in these manuscripts">\${absent} absent</span>\` : ""}
        \${missing.length ? \`<span class="chip" title="No record in the data for these manuscripts">\${missing.length} not checked</span>\` : ""}</summary>
        \${excerptHtml(l)}
        \${l && l.comment ? \`<p class="small muted">\${esc(l.comment)}</p>\` : ""}
        \${missing.length ? \`<p class="small muted">Not checked (no record): \${missing.map(esc).join(", ")}</p>\` : ""}<div class="syn-body">\${body}</div></details>\`;
    }).join("") || '<p class="muted">Kein Diagramm passt zu diesen Filtern.</p>';
  }
  ctl.redraw = render; ctl.reload = load;
  bindCards($("#groups"), ctl);
  bindExcerpts($("#groups"));
  bindDnd($("#groups"), ctl, () => render());
  drawBar(); await load(); trackStickyHeights();
}

/* ---- Verlauf: the changes of the classification, with undo */
async function synopsisHistory() {
  const draw = async () => {
    const changes = await api("/synopsis/changes?limit=400");
    const batches = [];
    for (const c of changes) {
      let b = batches[batches.length - 1];
      if (!b || b.batch !== c.batch) batches.push(b = { batch: c.batch, at: c.at, rows: [] });
      b.rows.push(c);
    }
    view.innerHTML = \`\${synNav("history")}
      <h1>Verlauf</h1>
      <p class="muted small">Jede Änderung an Schema, Differenzierungsebene, Hand, Kommentar, Apparat, Status, Platz, Bildquelle, Link und Tags wird mit altem und neuem Wert festgehalten. „Rückgängig“ stellt den alten Wert wieder her, sofern das Feld seither nicht erneut geändert wurde. Ziehen in eine Schema-Gruppe oder eine Mehrfachbearbeitung zählt als ein Schritt.</p>
      \${batches.length ? \`<table class="list"><thead><tr><th>Zeit</th><th>Änderung</th><th></th></tr></thead><tbody>\${batches.map(b => {
        const open = b.rows.filter(r => !r.undone);
        const items = new Set(b.rows.map(r => r.item_id)).size;
        const lines = b.rows.slice(0, 6).map(r => \`<div class="\${r.undone ? "muted" : ""}"><a href="#/synopsis/item?id=\${r.item_id}">\${esc(r.siglum)}, \${esc(r.folio)}</a> · \${esc(FIELD_DE[r.field] || r.field)}: \${esc(r.old) || "–"} → \${esc(r.new) || "–"}\${r.undone ? " (rückgängig gemacht)" : ""}</div>\`).join("");
        return \`<tr><td class="small">\${esc(b.at)}</td><td>\${lines}\${b.rows.length > 6 ? \`<div class="muted small">… und \${b.rows.length - 6} weitere Änderungen an \${items} Diagrammen</div>\` : ""}</td>
          <td>\${open.length ? \`<button data-undo="\${b.batch}">rückgängig</button>\` : '<span class="muted small">erledigt</span>'}</td></tr>\`;
      }).join("")}</tbody></table>\` : '<p class="muted">Noch keine Änderungen festgehalten.</p>'}\`;
    view.querySelectorAll("[data-undo]").forEach(btn => btn.onclick = guard(async () => {
      const ids = batches.find(b => b.batch === btn.dataset.undo).rows.filter(r => !r.undone).map(r => r.id);
      const r = await api("/synopsis/changes/revert", { method: "POST", body: { ids } });
      if (r.skipped.length) alert(\`\${r.done.length} Änderung(en) rückgängig gemacht, \${r.skipped.length} übersprungen (das Feld wurde seither erneut geändert).\`);
      draw();
    }));
  };
  await draw();
}

/* ---- Statistik: how often each schema occurs, by century, origin or manuscript */
async function synopsisStats() {
  const [opt, all] = await Promise.all([api("/synopsis/options"), api("/synopsis/items")]);
  const state = { by: "century", locus: "" };
  view.innerHTML = \`\${synNav("stats")}
    <h1>Statistik der Schemata</h1>
    <p class="muted small">Wie oft jedes Schema vorkommt, nach Jahrhundert, Herkunftsort oder Handschrift. Ein Klick auf eine Zahl öffnet die Diagramme in der Synopse. Gezählt werden Diagramme, nicht Handschriften.</p>
    <div class="filters"><label>Gruppieren nach <select id="st-by"><option value="century">Jahrhundert</option><option value="origin">Herkunftsort</option><option value="siglum">Handschrift</option></select></label>
      <label>Diagrammstelle <select id="st-locus"><option value="">alle Stellen</option>\${opt.loci.map(l => \`<option value="\${esc(l.code)}">\${esc(l.code)}\${l.chapter ? " · Kap. " + l.chapter : ""}</option>\`).join("")}</select></label></div>
    <div class="ed-wrap"><table class="list stats" id="st"></table></div>\`;
  const keyOf = (it, by) => by === "century" ? (it.centuries.length ? String(Math.min(...it.centuries)) : "") : by === "origin" ? (it.provenance || "") : it.siglum;
  const draw = () => {
    const items = all.groups.filter(g => g.locus && (!state.locus || g.locus.code === state.locus)).flatMap(g => g.items.map(i => ({ ...i, _locus: g.locus.code })));
    const col = it => it.status === "absent" ? "∅" : it.schema_value || "–";
    const cols = [...new Set(items.map(col))].sort((a, b) => romanOrder(a) - romanOrder(b) || a.localeCompare(b));
    const rows = new Map();
    for (const it of items) { const k = keyOf(it, state.by); if (!rows.has(k)) rows.set(k, {}); const r = rows.get(k), c = col(it); r[c] = (r[c] || 0) + 1; }
    const order = [...rows.keys()].sort((a, b) => state.by === "century" ? (+a || 99) - (+b || 99) : a.localeCompare(b));
    const max = Math.max(1, ...[...rows.values()].flatMap(r => Object.values(r)));
    const label = k => state.by === "century" ? (k ? \`\${k}. Jh.\` : "ohne Datierung") : k || "ohne Angabe";
    const link = (k, c, n) => {
      const f = { locus: state.locus ? [state.locus] : [], [state.by]: k ? [k] : [], schema: c === "∅" ? [] : [c === "–" ? SYN_NONE : c] };
      return n ? \`<a href="\${synHash("view", f)}" style="background: rgba(140, 90, 40, \${0.08 + 0.5 * n / max})">\${n}</a>\` : "";
    };
    $("#st").innerHTML = \`<thead><tr><th>\${state.by === "century" ? "Jahrhundert" : state.by === "origin" ? "Herkunftsort" : "Handschrift"}</th>\${cols.map(c => \`<th>\${c === "∅" ? "kein Diagramm" : c === "–" ? "ohne Schema" : "Schema " + esc(c)}</th>\`).join("")}<th>Summe</th></tr></thead>
      <tbody>\${order.map(k => { const r = rows.get(k); return \`<tr><th>\${esc(label(k))}</th>\${cols.map(c => \`<td class="stat-n">\${link(k, c, r[c] || 0)}</td>\`).join("")}<td class="stat-n">\${Object.values(r).reduce((a, b) => a + b, 0)}</td></tr>\`; }).join("")}</tbody>\`;
  };
  $("#st-by").onchange = e => { state.by = e.target.value; draw(); };
  $("#st-locus").onchange = e => { state.locus = e.target.value; draw(); };
  draw();
}

/* ---- tags: the vocabulary of the three categories */
async function synopsisTags() {
  const data = await api("/synopsis/tags");
  const draw = () => {
    view.innerHTML = \`\${synNav("tags")}
      <h1>Tags</h1>
      <p class="muted small">Tags werden in den Details eines Diagramms vergeben (Kasten „Tags“). Hier sieht man, wie oft jeder vorkommt, kann ihn umbenennen (überall zugleich) oder löschen (von jedem Diagramm). Ein Klick auf die Zahl zeigt die Diagramme. Eigene Kategorien lassen sich hinzufügen, umbenennen und löschen.</p>
      <form id="cat-form" class="row"><input id="cat-name" placeholder="Neue Kategorie, z. B. Tinte oder Ductus" size="34"><button class="primary">Kategorie hinzufügen</button></form>
      <div class="tags-grid">\${Object.entries(data.categories).map(([cat, name]) => {
        const tags = data.tags.filter(t => t.category === cat);
        return \`<section class="card"><div class="row"><h2 style="margin:0">\${esc(name)}</h2><span style="flex:1"></span><button class="link" data-cat-rename="\${esc(cat)}">Kategorie umbenennen</button><button class="link danger" data-cat-delete="\${esc(cat)}">Kategorie löschen</button></div>
          \${tags.length ? \`<table class="list"><tbody>\${tags.map(t => \`<tr><td>\${esc(t.name)}</td>
          <td><a href="\${synHash("view", { tag: [String(t.id)] })}">\${t.count}</a></td>
          <td><button class="link" data-rename="\${t.id}">umbenennen</button> <button class="link danger" data-delete="\${t.id}">löschen</button></td></tr>\`).join("")}</tbody></table>\` : '<p class="muted small">noch keine Tags</p>'}</section>\`;
      }).join("")}</div>\`;
  };
  const bind = () => {
    $("#cat-form").onsubmit = guard(async e => {
      e.preventDefault();
      const name = $("#cat-name").value.trim(); if (!name) return;
      Object.assign(data, await api("/synopsis/tags/categories", { method: "POST", body: { name } })); draw(); bind();
    });
    view.querySelector(".tags-grid").onclick = guard(async e => {
      const rename = e.target.dataset.rename, del = e.target.dataset.delete, catRename = e.target.dataset.catRename, catDelete = e.target.dataset.catDelete;
      if (catRename) {
        const name = prompt(\`Neuer Name für die Kategorie „\${data.categories[catRename]}“:\`, data.categories[catRename]);
        if (name === null || !name.trim() || name.trim() === data.categories[catRename]) return;
        Object.assign(data, await api(\`/synopsis/tags/categories/\${encodeURIComponent(catRename)}\`, { method: "PATCH", body: { name } })); draw(); bind();
      } else if (catDelete) {
        const n = data.tags.filter(t => t.category === catDelete).length;
        if (!confirm(\`Die Kategorie „\${data.categories[catDelete]}“\${n ? \` mit ihren \${n} Tags von allen Diagrammen\` : ""} löschen? Das kann nicht rückgängig gemacht werden.\`)) return;
        Object.assign(data, await api(\`/synopsis/tags/categories/\${encodeURIComponent(catDelete)}\`, { method: "DELETE" })); draw(); bind();
      } else if (rename) {
        const tag = data.tags.find(t => t.id === +rename), name = prompt(\`Neuer Name für den Tag „\${tag.name}“:\`, tag.name);
        if (name === null || !name.trim() || name.trim() === tag.name) return;
        await api(\`/synopsis/tags/\${rename}\`, { method: "PATCH", body: { name } });
        Object.assign(data, await api("/synopsis/tags")); draw(); bind();
      } else if (del) {
        const tag = data.tags.find(t => t.id === +del);
        if (!confirm(\`Den Tag „\${tag.name}“\${tag.count ? \` von seinen \${tag.count} Diagramm(en)\` : ""} löschen? Das kann nicht rückgängig gemacht werden.\`)) return;
        await api(\`/synopsis/tags/\${del}\`, { method: "DELETE" });
        Object.assign(data, await api("/synopsis/tags")); draw(); bind();
      }
    });
  };
  draw(); bind();
}

/* ---- one diagram on a page of its own (to keep next to the library's viewer in a second window) */
async function synopsisItemPage(params) {
  const id = +params.get("id");
  const [it, opt] = await Promise.all([api(\`/synopsis/items/\${id}\`), api("/synopsis/options")]);
  const ctl = { data: { groups: [{ locus: null, items: [it] }] }, loci: opt.loci, opt, cardOptions: {} };
  ctl.afterSave = async () => { Object.assign(opt, await api("/synopsis/options")); updateDatalists(opt); };
  view.innerHTML = \`\${synNav("view")}
    <div class="row"><a href="#/synopsis/manuscript?id=\${it.manuscript_id}">← \${esc(it.siglum)}</a><span style="flex:1"></span><span class="saved small" hidden>gespeichert</span></div>
    <h1>\${esc(it.siglum)} · \${esc(it.folio) || "–"}</h1>\${classDatalists(opt)}\${itemDetailHtml(it, ctl)}\`;
  bindItemDetail(view, it, ctl);
}

/* ---- overview: manuscripts (rows) by loci (columns) */
async function synopsisOverview(params) {
  const f = readFilters(params, OV_FILTERS);
  const [opt, all] = await Promise.all([api("/synopsis/options"), api("/synopsis/items")]);
  const cells = new Map();   // "manuscript id|locus code" -> items
  for (const g of all.groups) if (g.locus) for (const it of g.items) {
    const key = \`\${it.manuscript_id}|\${g.locus.code}\`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(it);
  }
  const lists = {
    locus: ["Diagrammstelle", opt.loci.map(l => ({ value: l.code, label: l.code, count: l.item_count }))],
    siglum: ["Handschrift (Sigle)", opt.manuscripts.map(m => ({ value: m.siglum, label: m.siglum, count: m.item_count }))],
    century: ["Jahrhundert", opt.centuries.map(c => ({ value: c, label: \`\${c}. Jh.\` }))],
    origin: ["Herkunftsort", opt.origins.map(o => ({ value: o, label: o.length > 60 ? o.slice(0, 58) + "…" : o }))],
  };
  const classOf = it => it.schema_value && romanOrder(it.schema_value) < 50 ? "s-" + romanOrder(it.schema_value) : it.schema_value ? "s-x" : "s-none";
  const chip = it => {
    if (it.status === "absent") return '<span class="ov-chip absent" title="Kein Diagramm in dieser Handschrift (geprüft)">∅</span>';
    const text = \`\${it.schema_value || "–"}\${it.schema_uncertain ? "?" : ""}\${it.level_value ? " " + it.level_value + (it.level_uncertain ? "?" : "") : ""}\${it.status === "erased-layer" ? "*" : ""}\`;
    const title = \`\${it.folio}: Schema \${it.schema_value || "nicht zugeordnet"}\${it.schema_uncertain ? " (unsicher)" : ""}\${it.level_value ? ", Ebene " + it.level_value : ""}\${it.status === "erased-layer" ? ", getilgte Schicht" : ""}\`;
    return \`<span class="ov-chip \${classOf(it)}" title="\${esc(title)}">\${esc(text)}</span>\`;
  };
  view.innerHTML = \`\${synNav("overview")}
    <h1>Überblick über die Schemata</h1>
    <p class="muted small">Eine Zeile je Handschrift, eine Spalte je Diagrammstelle. Eine Zelle zeigt Schema (und Ebene) jedes Diagramms; ein Klick auf die Zelle öffnet es in der Synopse.</p>
    <div class="filters" id="fbar"></div>
    <div class="ov-legend small">\${[1, 2, 3, 4, 5].map(n => \`<span class="ov-chip s-\${n}">\${["I", "II", "III", "IV", "V"][n - 1]}</span>\`).join(" ")}
      <span class="ov-chip s-none">–</span> Schema nicht zugeordnet · <span class="ov-chip absent">∅</span> kein Diagramm (geprüft) · <span class="ov-chip s-1">I a*</span> getilgte Schicht ·
      <span class="ov-chip s-1">I?</span> unsicher · <span class="ov-blank"></span> nicht geprüft (kein Datensatz)</div>
    <div class="ed-wrap"><table class="ov" id="ov"></table></div>\`;
  const draw = () => {
    const columns = opt.loci.filter(l => !f.locus.length || f.locus.includes(l.code));
    const rows = opt.manuscripts.filter(m => (!f.siglum.length || f.siglum.includes(m.siglum))
      && (!f.century.length || m.centuries.some(c => f.century.includes(String(c)))) && (!f.origin.length || f.origin.includes(m.origin)))
      .sort((a, b) => (a.centuries.length ? Math.min(...a.centuries) : 99) - (b.centuries.length ? Math.min(...b.centuries) : 99) || a.siglum.localeCompare(b.siglum));
    const tally = columns.map(l => {
      const t = {}; let absent = 0, unchecked = 0;
      for (const m of rows) {
        const items = cells.get(\`\${m.id}|\${l.code}\`);
        if (!items) { unchecked++; continue; }
        for (const it of items) { if (it.status === "absent") absent++; else { const k = it.schema_value || "–"; t[k] = (t[k] || 0) + 1; } }
      }
      return { t, absent, unchecked };
    });
    $("#ov").innerHTML = \`<thead><tr><th class="ov-ms">Handschrift</th>\${columns.map(l => \`<th><a href="\${synHash("view", { locus: [l.code] })}">\${esc(l.code)}</a><br><small class="muted">\${l.chapter ? "Kap. " + l.chapter : ""}</small></th>\`).join("")}</tr></thead>
      <tbody>\${rows.map(m => \`<tr><th class="ov-ms"><a href="#/synopsis/manuscript?id=\${m.id}">\${esc(m.siglum)}</a><br><small class="muted">\${esc(m.centuries.join(", "))}. Jh.</small></th>
        \${columns.map(l => { const items = cells.get(\`\${m.id}|\${l.code}\`);
          return items ? \`<td><a class="ov-cell" href="\${synHash("view", { locus: [l.code], siglum: [m.siglum] })}">\${items.map(chip).join("")}</a></td>\` : '<td class="unchecked"></td>'; }).join("")}</tr>\`).join("")}</tbody>
      <tfoot><tr><th class="ov-ms">Schemata in den angezeigten Zeilen</th>\${tally.map(x => \`<td class="small">\${Object.entries(x.t).sort(([a], [b]) => romanOrder(a) - romanOrder(b)).map(([k, n]) => \`\${esc(k)}: \${n}\`).join("<br>")}
        \${x.absent ? \`<br>∅: \${x.absent}\` : ""}\${x.unchecked ? \`<br><span class="muted">nicht geprüft: \${x.unchecked}</span>\` : ""}</td>\`).join("")}</tr></tfoot>\`;
  };
  const drawBar = () => {
    $("#fbar").innerHTML = OV_FILTERS.map(k => pickHtml(k, lists[k][0], lists[k][1], f[k].map(String))).join("") +
      (OV_FILTERS.some(k => f[k].length) ? '<button class="link" id="clear-all">alle Filter zurücksetzen</button>' : "");
    const c = $("#clear-all"); if (c) c.onclick = () => { OV_FILTERS.forEach(k => f[k] = []); sync(); };
  };
  const sync = () => { history.replaceState(null, "", synHash("overview", f, {}, OV_FILTERS)); drawBar(); draw(); };
  bindPicks($("#fbar"), f, sync);
  drawBar(); draw();
}

if (parseHash().name === "synopsis") route();   // app.js has already routed once, before this file registered the route
`,t=new Worker(new URL(new URL(`worker-C_Pc4eZo.js`,import.meta.url).href,``+import.meta.url),{type:`module`}),n=1,r=new Map;t.onmessage=e=>{let t=r.get(e.data.id);r.delete(e.data.id),t&&(e.data.error===void 0?t.resolve(e.data.result):t.reject(Object.assign(Error(e.data.error),{kind:e.data.kind})))};var i=(e,i={},a=[])=>new Promise((o,s)=>{let c=n++;r.set(c,{resolve:o,reject:s}),t.postMessage({id:c,op:e,args:i},a)});async function a(e,t,n={}){let r=Array.isArray(n.query)?n.query:Object.entries(n.query??{}).flatMap(([e,t])=>(Array.isArray(t)?t:[t]).map(t=>[e,String(t)])),a;if(n.form){let e={},t=[];for(let[r,i]of n.form.entries())typeof i==`string`?e[r]=i:t.push({field:r,name:i.name,data:new Uint8Array(await i.arrayBuffer())});a={fields:e,files:t}}return i(`request`,{method:e,path:t,query:r,json:n.json,form:a})}var o=new Map;function s(e,t={}){let n=[];t.max&&n.push([`max`,String(t.max)]),t.rot&&n.push([`rot`,String(t.rot)]),t.tilt&&n.push([`tilt`,String(t.tilt)]);let r=`${e}?${n.map(e=>e.join(`=`)).join(`&`)}`;return o.has(r)||o.set(r,a(`GET`,`/api/synopsis/images/${e}`,{query:n}).then(t=>{if(t.status!==200||!t.bytes)throw o.delete(r),Error(t.json?.detail??`image ${e}: ${t.status}`);return URL.createObjectURL(new Blob([t.bytes],{type:t.contentType}))})),o.get(r)}function c(){for(let e of o.values())e.then(e=>URL.revokeObjectURL(e),()=>{});o.clear()}var l=e=>String(e).replace(/[&<>"]/g,e=>({"&":`&amp;`,"<":`&lt;`,">":`&gt;`,'"':`&quot;`})[e]),u=e=>`${(e/1e6).toFixed(1)} MB`;async function d(){let e=await navigator.storage.persisted(),t=await navigator.storage.estimate();return{persisted:e,usage:t.usage??0,quota:t.quota??0}}async function f(){let{bytes:e}=await i(`exportBackup`),t=document.createElement(`a`);t.href=URL.createObjectURL(new Blob([e],{type:`application/zip`})),t.download=`synopse-backup-${new Date().toISOString().slice(0,10)}.zip`,t.click(),setTimeout(()=>URL.revokeObjectURL(t.href),1e4)}async function p(e,t=``,n=!1){let[r,a]=await Promise.all([i(`status`),d()]),o=r.counts;e.innerHTML=`
    <h1>Daten</h1>
    <p class="muted">Dieses Programm läuft ganz in deinem Browser. Es gibt keinen Server: Daten und Bilder liegen nur in diesem Browser, bis du sie als Backup-Datei speicherst.</p>
    ${t?`<p class="${n?`error`:``}" style="${n?``:`color:#1b6d3a`}">${l(t)}</p>`:``}
    <div class="card"><h2>Daten in diesem Browser</h2>
      ${r.hasData?`<table class="list"><tbody>
        <tr><td>Diagramme</td><td>${o.items}</td></tr><tr><td>Handschriften</td><td>${o.manuscripts}</td></tr>
        <tr><td>Diagrammstellen</td><td>${o.loci}</td></tr><tr><td>Bilddateien</td><td>${o.images}</td></tr>
        <tr><td>Programmversion</td><td>${l(r.programVersion)} (Daten zuletzt mit ${l(r.dataVersion??`unbekannt`)})</td></tr></tbody></table>`:`<p><strong>Noch keine Daten.</strong> Wähle die Backup-Datei (Zip), die du bekommen hast.</p>`}
      <p><label>Backup laden: <input type="file" id="file" accept=".zip,application/zip"></label>
        </p>
      ${r.hasData?`<p class="muted small">Beim Laden werden die vorhandenen Daten und Bilder ersetzt. Von der Datenbank wird vorher eine Kopie angelegt; die Bilder werden nicht kopiert, darum vorher ein Backup herunterladen.</p>
      <p><button id="export" class="primary">Backup herunterladen</button> <button id="wipe">Alle Daten in diesem Browser löschen</button></p>`:``}
    </div>
    <div class="card"><h2>Speicher</h2>
      <p>Belegt: ${u(a.usage)} von ${u(a.quota)}. Dauerhaft gesichert: <strong>${a.persisted?`ja`:`nein`}</strong>.</p>
      ${a.persisted?``:`<p><button id="persist">Browser bitten, die Daten dauerhaft zu behalten</button>
        <span class="muted small">Ohne diese Zusage kann ein Browser Daten löschen, wenn der Platz knapp wird (Safari auch nach 7 Tagen ohne Besuch). Ein Backup schützt in jedem Fall.</span></p>`}
    </div>
    ${r.snapshots.length?`<div class="card"><h2>Kopien der Datenbank</h2><p class="muted small">Automatisch vor einer neuen Programmversion und vor dem Laden eines Backups (die letzten fünf).</p>
      <ul>${r.snapshots.map(e=>`<li>${l(e)}</li>`).join(``)}</ul></div>`:``}`;let s=async t=>{if(!r.hasData||confirm(`Die vorhandenen Daten und Bilder in diesem Browser werden durch das Backup ersetzt. Fortfahren?`)){e.insertAdjacentHTML(`afterbegin`,`<p class="muted">Backup wird geladen …</p>`);try{c(),await i(`importBackup`,{bytes:t},[t]),location.hash=`#/synopsis`}catch(t){await p(e,`Das Backup konnte nicht geladen werden: ${t.message}`,!0)}}};document.getElementById(`file`)?.addEventListener(`change`,async e=>{let t=e.target.files?.[0];t&&await s(await t.arrayBuffer())}),document.getElementById(`dev`)?.addEventListener(`click`,async()=>s(await(await fetch(`/dev-data/backup.zip`)).arrayBuffer())),document.getElementById(`export`)?.addEventListener(`click`,()=>f()),document.getElementById(`wipe`)?.addEventListener(`click`,async()=>{confirm(`Alle Daten und Bilder in diesem Browser löschen? Das kann nicht rückgängig gemacht werden. Hast du ein Backup?`)&&(c(),await i(`wipe`),await p(e,`Alle Daten gelöscht.`))}),document.getElementById(`persist`)?.addEventListener(`click`,async()=>{await navigator.storage.persist(),await p(e)})}var m=window,h=document.getElementById(`view`);m.$=(e,t=document)=>t.querySelector(e),m.view=h,m.esc=e=>String(e??``).replace(/[&<>"']/g,e=>({"&":`&amp;`,"<":`&lt;`,">":`&gt;`,'"':`&quot;`,"'":`&#39;`})[e]),m.guard=e=>async(...t)=>{try{return await e(...t)}catch(e){alert(e.message)}},m.api=async(e,{method:t=`GET`,body:n,form:r}={})=>{let i=new URL(`/api`+e,`http://local`),o=await a(t,i.pathname,{query:[...i.searchParams.entries()],json:n,form:r});if(o.status>=400){let e=o.json?.detail;throw Error(typeof e==`string`?e:JSON.stringify(e??o.status))}return o.json};var g=(e,t)=>URL.createObjectURL(new Blob([e],{type:t}));m.synopsisHost={pictureUrl:(e,t)=>s(e,t),async editionImageUrl(e){let t=await a(`GET`,`/api/synopsis/editions/${e}/image`);if(t.status!==200||!t.bytes)throw Error(`no image`);return g(t.bytes,t.contentType)},async download(e){e===`backup`?await f():alert(`Der Excel-Export gehört noch nicht zur Browserversion. Das Backup (Zip) enthält alle Daten und Bilder.`)}},m.routes={data:()=>p(h)},m.parseHash=()=>{let[e,t=``]=location.hash.replace(/^#\/?/,``).split(`?`),[n=``,r]=e.split(`/`);return{name:n,arg:r,params:new URLSearchParams(t)}};var _=!1;m.route=async()=>{let{name:e,arg:t,params:n}=m.parseHash();if(_||=(await i(`status`)).hasData,!_&&e!==`data`)location.hash=`#/data`;else if(e===``)location.hash=`#/synopsis`;else{document.querySelectorAll(`header nav a[data-syn]`).forEach(t=>t.classList.toggle(`active`,e===`data`&&t.dataset.syn===`data`)),h.innerHTML=`<p class="muted">Wird geladen …</p>`;try{await(m.routes[e]??m.routes.synopsis)(t,n)}catch(e){h.innerHTML=`<p class="error">${m.esc(e.message)}</p>`}}},window.addEventListener(`hashchange`,()=>{_=!1,m.route()}),(async()=>{try{_=(await i(`start`)).hasData}catch(e){h.innerHTML=`<p class="error">Start fehlgeschlagen: ${m.esc(e.message)}</p>`;return}let t=document.createElement(`script`);t.textContent=e.replace(/^if \(parseHash\(\)\.name === "synopsis"\) route\(\);.*$/m,``),document.head.append(t),await m.route()})();