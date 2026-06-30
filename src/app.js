const { items } = window.ISAAC_SPINDOWN_DATA;

const byId = new Map(items.map((item) => [item.id, item]));
const byName = new Map(items.map((item) => [normalize(item.name), item]));
const validIds = items.map((item) => item.id).sort((a, b) => a - b);
const TEMP_LIFETIME_MS = 20000;
const DEFAULT_TARGET_IDS = [182, 223, 118, 331, 395, 678, 689, 691];
const SEARCH_CLEAN_PATTERN = /[^a-zA-Z0-9?]+|^(the|a|an)\s/gi;
const MULTI_ITEM_PATTERN = /"(?:(.*?)(?:###(\w+))?)"/gi;

const state = {
  tracked: loadTracked(),
  targets: load("targets", DEFAULT_TARGET_IDS).filter((id) =>
    byId.has(id),
  ),
  selectedTarget: Number(localStorage.getItem("spindown-selected-target")) || null,
  plannerOpen: localStorage.getItem("spindown-planner-open") === "true",
  depth: Number(localStorage.getItem("spindown-depth") || 12),
};

if (!byId.has(state.selectedTarget)) {
  state.selectedTarget = state.targets[0] || null;
}

const els = {
  shopInput: document.querySelector("#shopInput"),
  targetInput: document.querySelector("#targetInput"),
  shopSuggestions: document.querySelector("#shopSuggestions"),
  targetSuggestions: document.querySelector("#targetSuggestions"),
  addShop: document.querySelector("#addShop"),
  addTarget: document.querySelector("#addTarget"),
  depthInput: document.querySelector("#depthInput"),
  depthValue: document.querySelector("#depthValue"),
  clearAll: document.querySelector("#clearAll"),
  targetChips: document.querySelector("#targetChips"),
  targetPlanner: document.querySelector("#targetPlanner"),
  togglePlanner: document.querySelector("#togglePlanner"),
  plannerTitle: document.querySelector("#plannerTitle"),
  reversePlanner: document.querySelector("#reversePlanner"),
  tracker: document.querySelector("#tracker"),
  emptyTemplate: document.querySelector("#emptyTemplate"),
};

els.depthInput.value = state.depth;
els.depthValue.textContent = state.depth;

function normalize(value) {
  return String(value).trim().toLowerCase().replace(/\s+/g, " ");
}

function compact(value) {
  return String(value)
    .toLowerCase()
    .replaceAll(SEARCH_CLEAN_PATTERN, "");
}

function multiItemNames(value) {
  const text = String(value).trim();
  if (!text.startsWith("[[") || !text.endsWith("]]")) return [];
  return [...text.matchAll(MULTI_ITEM_PATTERN)].map((match) => match[1]).filter(Boolean);
}

function load(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(`spindown-${key}`));
    return Array.isArray(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function loadTracked() {
  const stored = load("tracked", []);
  return stored
    .map((entry) => {
      if (typeof entry === "number") {
        return { id: entry, pinned: true, createdAt: Date.now() };
      }
      return {
        id: Number(entry?.id),
        pinned: Boolean(entry?.pinned),
        createdAt: Number(entry?.createdAt) || Date.now(),
      };
    })
    .filter((entry) => byId.has(entry.id));
}

function save() {
  localStorage.setItem("spindown-tracked", JSON.stringify(state.tracked));
  localStorage.setItem("spindown-targets", JSON.stringify(state.targets));
  localStorage.setItem("spindown-selected-target", String(state.selectedTarget || ""));
  localStorage.setItem("spindown-planner-open", String(state.plannerOpen));
  localStorage.setItem("spindown-depth", String(state.depth));
}

function itemForText(text) {
  const clean = normalize(text);
  if (!clean) return null;
  if (/^\d+$/.test(clean) && byId.has(Number(clean))) return byId.get(Number(clean));
  const exact = byName.get(clean);
  if (exact) return exact;
  const [best] = suggestions(clean, 1);
  return best || null;
}

function suggestions(query, limit = 32) {
  const q = normalize(query);
  if (!q) return [];
  const multiNames = multiItemNames(q);
  if (multiNames.length) {
    return multiNames
      .map((name) => byName.get(normalize(name)))
      .filter(Boolean)
      .slice(0, limit);
  }
  const cleanQuery = compact(q);
  const queryParts = q.split(" ").filter(Boolean);
  const scored = items
    .map((item) => {
      const name = normalize(item.name);
      const cleanName = item.cleanName || compact(item.name);
      const keywords = item.keywords || "";
      const searchText = item.searchText || keywords;
      const tags = item.tags || [];
      const guruId = `c${item.id}`;
      const keywordIndex = searchText.indexOf(q);
      const exactTag = tags.includes(q);
      const tagPrefix = tags.some((tag) => tag.startsWith(q));
      let score = 0;
      if (name === q || String(item.id) === q || guruId === cleanQuery) score = 1200;
      else if (cleanName === cleanQuery) score = 1160;
      else if (guruId.includes(cleanQuery)) score = 1040 - String(item.id).length;
      else if (exactTag) score = 980 - name.length;
      else if (tagPrefix) score = 900 - name.length;
      else if (name.startsWith(q) || cleanName.startsWith(cleanQuery)) score = 920 - name.length;
      else if (keywordIndex === 0) score = 840 - searchText.length / 20;
      else if (name.includes(q) || cleanName.includes(cleanQuery)) {
        score = 720 - Math.min(name.indexOf(q), cleanName.indexOf(cleanQuery));
      } else if (keywordIndex > 0) {
        score = 620 - keywordIndex;
      }
      else {
        const matched = queryParts.filter((part) => item.words?.some((word) => word.startsWith(part))).length;
        if (matched) {
          score = 360 + matched * 55 - name.length;
        } else if (cleanQuery.length >= 3) {
          const distance = levenshtein(cleanQuery, cleanName, 3);
          if (distance <= Math.max(1, Math.floor(cleanQuery.length / 4))) {
            score = 260 - distance * 45 - name.length;
          }
        }
      }
      return { item, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.item.id - b.item.id);
  return scored.slice(0, limit).map((entry) => entry.item);
}

function levenshtein(a, b, maxDistance = Infinity) {
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = current[0];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost,
      );
      rowMin = Math.min(rowMin, current[j]);
    }
    if (rowMin > maxDistance) return maxDistance + 1;
    previous = current;
  }
  return previous[b.length];
}

function previousValidId(id) {
  for (let i = id - 1; i >= 1; i -= 1) {
    if (byId.has(i)) return i;
  }
  return null;
}

function nextValidId(id) {
  for (let i = id + 1; i <= validIds[validIds.length - 1]; i += 1) {
    if (byId.has(i)) return i;
  }
  return null;
}

function chainFrom(id, depth) {
  const chain = [];
  let current = id;
  for (let step = 0; step <= depth && current; step += 1) {
    const item = byId.get(current);
    if (!item) break;
    chain.push({ ...item, step });
    current = previousValidId(current);
  }
  return chain;
}

function reverseChainTo(id, depth) {
  const chain = [];
  let current = nextValidId(id);
  for (let step = 1; step <= depth && current; step += 1) {
    const item = byId.get(current);
    if (!item) break;
    chain.push({ ...item, step });
    current = nextValidId(current);
  }
  return chain;
}

function targetHits(chain) {
  const targets = new Set(state.targets);
  return chain.filter((item) => item.step > 0 && targets.has(item.id));
}

function addTracked(item, options = {}) {
  if (!item) return;
  const pinned = Boolean(options.pinned);
  const existing = state.tracked.find((entry) => entry.id === item.id);
  if (existing) {
    existing.createdAt = Date.now();
    existing.pinned = existing.pinned || pinned;
    state.tracked = [existing, ...state.tracked.filter((entry) => entry.id !== item.id)];
    save();
    render();
    return;
  }
  state.tracked.unshift({ id: item.id, pinned, createdAt: Date.now() });
  save();
  render();
}

function addTarget(item) {
  if (!item) return;
  if (state.targets.includes(item.id)) {
    state.selectedTarget = item.id;
    state.plannerOpen = true;
    save();
    render();
    return;
  }
  state.targets.unshift(item.id);
  state.selectedTarget = item.id;
  state.plannerOpen = true;
  save();
  render();
}

function removeTracked(id) {
  state.tracked = state.tracked.filter((entry) => entry.id !== id);
  save();
  render();
}

function pinTracked(id) {
  const entry = state.tracked.find((tracked) => tracked.id === id);
  if (!entry) return;
  entry.pinned = true;
  save();
  render();
}

function cleanupExpired() {
  const now = Date.now();
  const before = state.tracked.length;
  state.tracked = state.tracked.filter(
    (entry) => entry.pinned || now - entry.createdAt < TEMP_LIFETIME_MS,
  );
  if (state.tracked.length !== before) {
    save();
    render();
  }
}

function secondsLeft(entry) {
  if (entry.pinned) return null;
  return Math.max(0, Math.ceil((TEMP_LIFETIME_MS - (Date.now() - entry.createdAt)) / 1000));
}

function updateCountdowns() {
  for (const badge of document.querySelectorAll("[data-countdown-id]")) {
    const entry = state.tracked.find((tracked) => tracked.id === Number(badge.dataset.countdownId));
    if (!entry || entry.pinned) continue;
    badge.textContent = `${secondsLeft(entry)}s`;
  }
}

function removeTarget(id) {
  state.targets = state.targets.filter((itemId) => itemId !== id);
  if (state.selectedTarget === id) {
    state.selectedTarget = state.targets[0] || null;
  }
  save();
  render();
}

function renderSuggestions(input, panel, mode) {
  const picks = suggestions(input.value);
  input.setAttribute("aria-expanded", picks.length ? "true" : "false");
  panel.innerHTML = picks
    .map(
      (item, index) => `
      <div
        class="suggestion ${index === 0 ? "is-active" : ""}"
        role="option"
        aria-selected="${index === 0 ? "true" : "false"}"
        data-id="${item.id}"
      >
        <img src="${item.image}" alt="" loading="lazy" />
        <span>${item.name}</span>
        <b>#${item.id}</b>
      </div>`,
    )
    .join("");
  panel.dataset.mode = mode;
}

function commitInput(input, mode, options = {}) {
  const item = itemForText(input.value);
  if (!item) return;
  if (mode === "shop") addTracked(item, options);
  else addTarget(item);
  input.value = "";
  closeSuggestions();
}

function closeSuggestions() {
  els.shopSuggestions.innerHTML = "";
  els.targetSuggestions.innerHTML = "";
  els.shopInput.setAttribute("aria-expanded", "false");
  els.targetInput.setAttribute("aria-expanded", "false");
}

function renderTargets() {
  if (!state.targets.length) {
    els.targetChips.innerHTML = `<span class="muted">No target items yet.</span>`;
    return;
  }

  els.targetChips.innerHTML = state.targets
    .map((id) => {
      const item = byId.get(id);
      return `
      <button type="button" class="chip ${state.selectedTarget === id ? "is-selected" : ""}" data-select-target="${id}" title="Plan route to ${item.name}">
        <img src="${item.image}" alt="" />
        <span>${item.name}</span>
        <b>#${id}</b>
        <i data-remove-target="${id}" aria-label="Remove ${item.name}">x</i>
      </button>`;
    })
    .join("");
}

function renderReversePlanner() {
  const target = byId.get(state.selectedTarget);
  els.targetPlanner.classList.toggle("is-collapsed", !state.plannerOpen);
  els.togglePlanner.textContent = state.plannerOpen ? "Hide routes" : "Show routes";
  els.togglePlanner.setAttribute("aria-expanded", String(state.plannerOpen));

  if (!target) {
    els.plannerTitle.textContent = "Click a target item";
    els.togglePlanner.textContent = state.plannerOpen ? "Hide" : "Show";
    els.reversePlanner.innerHTML =
      '<p class="muted">Add a target item above, then click it to see which visible items spin down into it.</p>';
    return;
  }

  const feeders = reverseChainTo(target.id, state.depth);
  els.plannerTitle.textContent = `Routes into ${target.name}`;
  els.reversePlanner.innerHTML = `
    <div class="target-focus">
      <img src="${target.image}" alt="" />
      <div>
        <p class="eyebrow">Target #${target.id}</p>
        <strong>${target.name}</strong>
        <span>Collectible #${target.id}</span>
      </div>
    </div>
    <div class="reverse-chain">
      ${
        feeders.length
          ? feeders.map(renderFeederItem).join("")
          : '<p class="muted">Nothing above this target in the current Spin Down list.</p>'
      }
    </div>`;
}

function renderFeederItem(item) {
  return `
    <button type="button" class="feeder" data-id="${item.id}" title="Track ${item.name}">
      <span>${item.step}</span>
      <img src="${item.image}" alt="" loading="lazy" />
      <strong>${item.name}</strong>
      <small>#${item.id}</small>
    </button>`;
}

function renderTracker() {
  if (!state.tracked.length) {
    els.tracker.innerHTML = "";
    els.tracker.append(els.emptyTemplate.content.cloneNode(true));
    return;
  }

  els.tracker.innerHTML = state.tracked
    .map((entry) => {
      const id = entry.id;
      const start = byId.get(id);
      const chain = chainFrom(id, state.depth);
      const hits = targetHits(chain);
      const nearest = hits[0];
      const remaining = secondsLeft(entry);
      return `
      <article class="track-card ${entry.pinned ? "is-pinned" : "is-temporary"}">
        <header class="track-head">
          <div class="start-item">
            <img src="${start.image}" alt="" />
            <div>
              <p class="eyebrow">Seen item #${start.id}</p>
              <h2>${start.name}</h2>
              <p>Collectible #${start.id}</p>
            </div>
          </div>
          <div class="track-actions">
            ${
              entry.pinned
                ? '<div class="lifetime is-pinned">Kept</div>'
                : `<button type="button" class="keep-button" data-pin="${id}" title="Keep ${start.name} on screen">Keep <b data-countdown-id="${id}">${remaining}s</b></button>`
            }
            ${
              nearest
                ? `<div class="hit-callout"><b>${nearest.step}</b><span>spins to ${nearest.name}</span></div>`
                : `<div class="hit-callout is-dim"><b>-</b><span>No target item in ${state.depth}</span></div>`
            }
            <button type="button" class="icon-button" data-remove="${id}" aria-label="Remove ${start.name}">x</button>
          </div>
        </header>
        ${renderHits(hits)}
        <div class="chain" aria-label="Spin Down chain from ${start.name}">
          ${chain.map(renderChainItem).join("")}
        </div>
      </article>`;
    })
    .join("");
}

function renderHits(hits) {
  if (!hits.length) return "";
  return `
    <div class="hit-strip">
      ${hits
        .map(
          (item) => `
        <span>
          <img src="${item.image}" alt="" />
          <b>${item.step}</b>
          ${item.name}
        </span>`,
        )
        .join("")}
    </div>`;
}

function renderChainItem(item) {
  const watched = state.targets.includes(item.id);
  return `
    <section class="chain-item ${item.step === 0 ? "is-origin" : ""} ${watched ? "is-target" : ""}">
      <div class="step-badge">${item.step === 0 ? "now" : item.step}</div>
      <img src="${item.image}" alt="" loading="lazy" />
      <h3>${item.name}</h3>
      <p>Collectible #${item.id}</p>
      <footer>#${item.id}</footer>
    </section>`;
}

function render() {
  renderTargets();
  renderReversePlanner();
  renderTracker();
  document.documentElement.style.setProperty("--tracked-count", state.tracked.length);
}

function wireCombo(input, panel, mode) {
  input.addEventListener("input", () => renderSuggestions(input, panel, mode));
  input.addEventListener("focus", () => renderSuggestions(input, panel, mode));
  input.addEventListener("keydown", (event) => {
    const buttons = [...panel.querySelectorAll(".suggestion")];
    const activeIndex = buttons.findIndex((button) => button.classList.contains("is-active"));
    if (event.key === "ArrowDown" && buttons.length) {
      event.preventDefault();
      buttons[activeIndex]?.classList.remove("is-active");
      buttons[activeIndex]?.setAttribute("aria-selected", "false");
      const next = buttons[(activeIndex + 1) % buttons.length];
      next.classList.add("is-active");
      next.setAttribute("aria-selected", "true");
      next.scrollIntoView({ block: "nearest" });
    }
    if (event.key === "ArrowUp" && buttons.length) {
      event.preventDefault();
      buttons[activeIndex]?.classList.remove("is-active");
      buttons[activeIndex]?.setAttribute("aria-selected", "false");
      const next = buttons[(activeIndex - 1 + buttons.length) % buttons.length];
      next.classList.add("is-active");
      next.setAttribute("aria-selected", "true");
      next.scrollIntoView({ block: "nearest" });
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const selected = panel.querySelector(".suggestion.is-active");
      if (selected) input.value = byId.get(Number(selected.dataset.id)).name;
      commitInput(input, mode, { pinned: event.shiftKey });
    }
    if (event.key === "Escape") closeSuggestions();
  });
  panel.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    if (event.pointerType !== "touch") {
      event.preventDefault();
      input.focus();
    }
  });
  panel.addEventListener("click", (event) => {
    event.stopPropagation();
    const button = event.target.closest(".suggestion");
    if (!button) return;
    const item = byId.get(Number(button.dataset.id));
    if (mode === "shop") addTracked(item);
    else addTarget(item);
    input.value = "";
    closeSuggestions();
  });
}

wireCombo(els.shopInput, els.shopSuggestions, "shop");
wireCombo(els.targetInput, els.targetSuggestions, "target");

els.addShop.addEventListener("click", () => commitInput(els.shopInput, "shop"));
els.addTarget.addEventListener("click", () => commitInput(els.targetInput, "target"));
els.clearAll.addEventListener("click", () => {
  state.tracked = [];
  save();
  render();
});
els.togglePlanner.addEventListener("click", () => {
  state.plannerOpen = !state.plannerOpen;
  save();
  renderReversePlanner();
});
els.depthInput.addEventListener("input", () => {
  state.depth = Number(els.depthInput.value);
  els.depthValue.textContent = state.depth;
  save();
  renderTracker();
});
els.reversePlanner.addEventListener("click", (event) => {
  const button = event.target.closest("[data-id]");
  if (button) addTracked(byId.get(Number(button.dataset.id)));
});
document.addEventListener("click", (event) => {
  const remove = event.target.closest("[data-remove]");
  const pin = event.target.closest("[data-pin]");
  const removeTargetButton = event.target.closest("[data-remove-target]");
  const selectTarget = event.target.closest("[data-select-target]");
  if (remove) removeTracked(Number(remove.dataset.remove));
  if (pin) pinTracked(Number(pin.dataset.pin));
  if (removeTargetButton) {
    event.stopPropagation();
    removeTarget(Number(removeTargetButton.dataset.removeTarget));
  } else if (selectTarget) {
    state.selectedTarget = Number(selectTarget.dataset.selectTarget);
    state.plannerOpen = true;
    save();
    render();
  }
  if (!event.target.closest(".combo")) closeSuggestions();
});

render();
setInterval(() => {
  cleanupExpired();
  updateCountdowns();
}, 1000);
