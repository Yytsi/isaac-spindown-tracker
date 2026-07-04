// Grid FX: full-viewport canvas animation played when an item is tracked.
// Draws the whole collection as a wall of sprites, sends a box cursor to the
// typed item, carves out its spin-down chain, and docks it as a strip at the
// bottom of the visible viewport (above the keyboard on mobile).
(() => {
  const data = window.ISAAC_SPINDOWN_DATA;
  if (!data) return;

  const GOLD = "#f5b84b";
  const GREEN = "#98c76a";
  const INK = "#f3ead3";

  const sorted = data.items.slice().sort((a, b) => a.id - b.id);
  const indexById = new Map(sorted.map((item, index) => [item.id, index]));
  const COUNT = sorted.length;

  // --- Sprite atlas -------------------------------------------------------
  const SPRITE = 64;
  const ATLAS_COLS = 32;
  const atlas = document.createElement("canvas");
  atlas.width = ATLAS_COLS * SPRITE;
  atlas.height = Math.ceil(COUNT / ATLAS_COLS) * SPRITE;
  const atlasCtx = atlas.getContext("2d");
  const loaded = new Uint8Array(COUNT);
  let atlasDirty = false;

  const queue = sorted.map((_, index) => index);
  let inFlight = 0;
  const MAX_INFLIGHT = 10;

  function pump() {
    while (inFlight < MAX_INFLIGHT && queue.length) {
      const index = queue.shift();
      if (loaded[index]) continue;
      inFlight += 1;
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        atlasCtx.drawImage(
          img,
          (index % ATLAS_COLS) * SPRITE,
          Math.floor(index / ATLAS_COLS) * SPRITE,
          SPRITE,
          SPRITE,
        );
        loaded[index] = 1;
        atlasDirty = true;
        inFlight -= 1;
        pump();
      };
      img.onerror = () => {
        inFlight -= 1;
        pump();
      };
      img.src = sorted[index].image;
    }
  }

  function prioritize(indices) {
    queue.unshift(...indices.filter((index) => !loaded[index]));
    pump();
  }

  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1200));
  idle(() => pump());

  // --- Helpers ------------------------------------------------------------
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const lerp = (a, b, p) => a + (b - a) * p;
  const easeOutCubic = (p) => 1 - (1 - p) ** 3;
  const easeInOutCubic = (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
  const easeInCubic = (p) => p * p * p;

  function roundRectPath(ctx, x, y, w, h, r) {
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      return;
    }
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawSprite(ctx, index, x, y, size) {
    if (loaded[index]) {
      ctx.drawImage(
        atlas,
        (index % ATLAS_COLS) * SPRITE,
        Math.floor(index / ATLAS_COLS) * SPRITE,
        SPRITE,
        SPRITE,
        x,
        y,
        size,
        size,
      );
    } else {
      ctx.fillStyle = "rgba(243, 234, 211, 0.07)";
      ctx.fillRect(x, y, size, size);
    }
  }

  // --- Animation ----------------------------------------------------------
  let active = null;

  function play({ originId, chainIds, targetIds, seekTo }) {
    const originIndex = indexById.get(originId);
    if (originIndex == null) return Promise.resolve();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return Promise.resolve();
    }
    if (active) active.finish();

    const vv = window.visualViewport;
    const width = Math.round(vv ? vv.width : window.innerWidth);
    const height = Math.round(vv ? vv.height : window.innerHeight);
    if (width < 120 || height < 120) return Promise.resolve();

    // Display grid geometry: fit every item above a reserved strip zone.
    const pad = 14;
    const stripZone = 78;
    const gw = width - pad * 2;
    const gh = height - pad * 2 - stripZone;
    let cell = Math.max(5, Math.floor(Math.sqrt((gw * gh) / COUNT)));
    let cols;
    let rows;
    for (;;) {
      cols = Math.max(1, Math.floor(gw / cell));
      rows = Math.ceil(COUNT / cols);
      if (rows * cell <= gh || cell <= 5) break;
      cell -= 1;
    }
    const originX = pad + (gw - cols * cell) / 2;
    const originY = pad + Math.max(0, (gh - rows * cell) / 2);
    const cellPos = (index) => ({
      x: originX + (index % cols) * cell,
      y: originY + Math.floor(index / cols) * cell,
    });

    const carved = chainIds
      .map((id) => indexById.get(id))
      .filter((index) => index != null);
    const targets = new Set(targetIds || []);
    prioritize(carved);

    // Strip layout at the bottom of the overlay.
    const maxSlots = Math.max(3, Math.floor((width - 80) / 22));
    const visualCap = Math.min(carved.length, maxSlots, 22);
    const slot = clamp(Math.floor((width - 90) / Math.max(visualCap, 1)) - 4, 16, 34);
    const stripW = visualCap * (slot + 4) - 4;
    const stripX = (width - stripW) / 2;
    const stripY = height - stripZone + (stripZone - slot) / 2 - 6;
    const overflow = carved.length - visualCap;

    // Phase boundaries (ms).
    const FADE = 140;
    const targetRow = Math.floor(originIndex / cols);
    const targetCol = originIndex % cols;
    const pathLen = targetRow + targetCol;
    const SEEK = pathLen === 0 ? 120 : 420;
    const LOCK = 220;
    const CARVE = Math.min(140 + carved.length * 24, 640);
    const EXTRACT = 340 + 18 * Math.max(visualCap - 1, 0);
    const SETTLE = 160;
    const OUT = 220;
    const tSeek = FADE;
    const tLock = tSeek + SEEK;
    const tCarve = tLock + LOCK;
    const tExtract = tCarve + CARVE;
    const tSettle = tExtract + EXTRACT;
    const tOut = tSettle + SETTLE;
    const tEnd = tOut + OUT;

    const overlay = document.createElement("div");
    overlay.className = "gridfx";
    overlay.style.top = `${vv ? vv.offsetTop : 0}px`;
    overlay.style.left = `${vv ? vv.offsetLeft : 0}px`;
    overlay.style.width = `${width}px`;
    overlay.style.height = `${height}px`;
    const canvas = document.createElement("canvas");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const actions = document.createElement("div");
    actions.className = "gridfx-actions";
    const viewButton = document.createElement("button");
    viewButton.type = "button";
    viewButton.className = "gridfx-view";
    viewButton.innerHTML = "View item <kbd>&#9166;</kbd>";
    const stayButton = document.createElement("button");
    stayButton.type = "button";
    stayButton.className = "gridfx-stay";
    stayButton.innerHTML = "Keep typing <kbd>Esc</kbd>";
    actions.append(viewButton, stayButton);
    overlay.append(canvas, actions);
    document.body.append(overlay);
    requestAnimationFrame(() => {
      overlay.style.opacity = "1";
    });

    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    // Pre-rendered wall of sprites, refreshed when new sprites finish loading.
    const layer = document.createElement("canvas");
    layer.width = canvas.width;
    layer.height = canvas.height;
    const layerCtx = layer.getContext("2d");
    layerCtx.scale(dpr, dpr);
    function renderBase() {
      layerCtx.clearRect(0, 0, width, height);
      const inset = Math.max(1, cell * 0.08);
      for (let i = 0; i < COUNT; i += 1) {
        const { x, y } = cellPos(i);
        drawSprite(layerCtx, i, x + inset, y + inset, cell - inset * 2);
      }
      atlasDirty = false;
    }
    renderBase();

    const item = sorted[originIndex];
    const label = `${item.name}  #${item.id}`;
    const trail = [];
    let frame = 0;
    let done = false;
    let fadeOutStarted = false;
    let actionsOpen = false;
    let released = false;
    let choice = "stay";
    let selected = "view";
    let holdTimer = 0;

    function setSelected(which) {
      selected = which;
      viewButton.classList.toggle("is-selected", which === "view");
      stayButton.classList.toggle("is-selected", which === "stay");
    }
    let start = performance.now() - (Number(seekTo) || 0);

    // The timeline pauses on the docked strip until the user picks an
    // action (or the hold times out); choose() resumes it at the OUT phase.
    function choose(picked) {
      if (done || released) return;
      released = true;
      choice = picked;
      clearTimeout(holdTimer);
      actions.classList.remove("is-open");
      start = performance.now() - tOut;
    }

    function cursorAt(t) {
      if (t >= tLock || pathLen === 0) {
        return { col: targetCol, row: targetRow };
      }
      const p = easeInOutCubic(clamp((t - tSeek) / SEEK, 0, 1));
      const d = p * pathLen;
      return d <= targetRow
        ? { col: 0, row: d }
        : { col: d - targetRow, row: targetRow };
    }

    function drawCursor(x, y, size, alpha, scale, color) {
      const cx = x + size / 2;
      const cy = y + size / 2;
      const half = (size * scale) / 2 + 3;
      const arm = Math.max(5, size * 0.38);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(2, size * 0.1);
      ctx.lineCap = "square";
      ctx.shadowColor = color;
      ctx.shadowBlur = 12;
      for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const px = cx + dx * half;
        const py = cy + dy * half;
        ctx.beginPath();
        ctx.moveTo(px - dx * arm, py);
        ctx.lineTo(px, py);
        ctx.lineTo(px, py - dy * arm);
        ctx.stroke();
      }
      ctx.restore();
    }

    function drawLabel(alpha) {
      const { x, y } = cellPos(originIndex);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = "700 13px ui-monospace, Menlo, monospace";
      const textW = ctx.measureText(label).width;
      const bw = textW + 22;
      const bh = 27;
      const bx = clamp(x + cell / 2 - bw / 2, 8, width - bw - 8);
      let by = y - bh - 12;
      if (by < 8) by = y + cell + 12;
      roundRectPath(ctx, bx, by, bw, bh, 6);
      ctx.fillStyle = "rgba(12, 9, 6, 0.94)";
      ctx.fill();
      ctx.strokeStyle = "rgba(245, 184, 75, 0.55)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = GOLD;
      ctx.textBaseline = "middle";
      ctx.fillText(label, bx + 11, by + bh / 2 + 1);
      ctx.restore();
    }

    function draw(now) {
      if (done) return;
      let t = now - start;
      if (!released) {
        if (t >= tSettle && !actionsOpen) {
          actionsOpen = true;
          actions.classList.add("is-open");
          setSelected("view");
          holdTimer = setTimeout(() => choose("stay"), 4200);
        }
        if (t >= tOut) t = tOut - 1;
      }
      if (t >= tEnd) {
        finish();
        return;
      }
      if (atlasDirty) renderBase();

      const carveP = clamp((t - tCarve) / CARVE, 0, 1);
      const extractP = clamp((t - tExtract) / EXTRACT, 0, 1);

      ctx.clearRect(0, 0, width, height);

      // The wall, dimming once the carve starts.
      ctx.save();
      ctx.globalAlpha = 1 - 0.68 * easeOutCubic(Math.max(carveP, extractP));
      ctx.drawImage(layer, 0, 0, width, height);
      ctx.restore();

      // Seeking cursor with trail.
      if (t >= tSeek && t < tCarve + CARVE) {
        const pos = cursorAt(t);
        const px = originX + pos.col * cell;
        const py = originY + pos.row * cell;
        if (t < tLock) {
          trail.push({ x: px, y: py, at: t });
          for (const ghost of trail) {
            const ga = Math.max(0, 1 - (t - ghost.at) / 170) * 0.4;
            if (ga > 0.02) drawCursor(ghost.x, ghost.y, cell, ga, 1, GOLD);
          }
          drawCursor(px, py, cell, 1, 1, GOLD);
        } else {
          const lockP = clamp((t - tLock) / LOCK, 0, 1);
          const pulse = 1 + 0.4 * Math.sin(Math.min(lockP, 1) * Math.PI);
          drawCursor(px, py, cell, 1, pulse, GOLD);
        }
      }

      // Carve: chain cells light up in spin-down order.
      if (t >= tCarve && extractP < 1) {
        const stagger = Math.max(12, (CARVE - 160) / Math.max(carved.length, 1));
        for (let k = 0; k < carved.length; k += 1) {
          const a = clamp((t - tCarve - k * stagger) / 150, 0, 1);
          if (a <= 0) continue;
          const index = carved[k];
          const { x, y } = cellPos(index);
          const flying = t >= tExtract && k < visualCap;
          if (flying) continue;
          const fade = t >= tExtract ? 1 - extractP : 1;
          const color = targets.has(sorted[index].id) ? GREEN : GOLD;
          ctx.save();
          ctx.globalAlpha = a * fade;
          drawSprite(ctx, index, x + 1, y + 1, cell - 2);
          ctx.strokeStyle = color;
          ctx.lineWidth = Math.max(1.5, cell * 0.08);
          ctx.shadowColor = color;
          ctx.shadowBlur = 8;
          ctx.strokeRect(x + 0.5, y + 0.5, cell - 1, cell - 1);
          ctx.restore();
        }
      }

      if (t >= tLock && t < tExtract + 160) {
        drawLabel(clamp((t - tLock) / 160, 0, 1) * clamp(1 - (t - tExtract) / 160, 0, 1));
      }

      // Extract: carved cells fly into the docked strip.
      if (t >= tExtract) {
        const settleP = clamp((t - tSettle) / SETTLE, 0, 1);
        const outP = clamp((t - tOut) / OUT, 0, 1);
        const dropY = easeInCubic(outP) * 70;
        if (outP > 0 && !fadeOutStarted) {
          fadeOutStarted = true;
          overlay.style.opacity = "0";
        }

        ctx.save();
        ctx.translate(0, dropY);

        // Strip backing.
        const backA = clamp((t - tExtract - 180) / 200, 0, 1);
        if (backA > 0) {
          const pulse = 1 + 0.03 * Math.sin(settleP * Math.PI);
          const bw = stripW + 24;
          const bh = slot + 20;
          const bx = stripX - 12 + (bw - bw * pulse) / 2;
          const by = stripY - 10 + (bh - bh * pulse) / 2;
          ctx.save();
          ctx.globalAlpha = backA;
          roundRectPath(ctx, bx, by, bw * pulse, bh * pulse, 8);
          ctx.fillStyle = "rgba(245, 184, 75, 0.1)";
          ctx.fill();
          ctx.strokeStyle = "rgba(245, 184, 75, 0.4)";
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.restore();
        }

        for (let k = 0; k < visualCap; k += 1) {
          const index = carved[k];
          const startPos = cellPos(index);
          const endX = stripX + k * (slot + 4);
          const endY = stripY;
          const p = easeInOutCubic(clamp((t - tExtract - k * 18) / 340, 0, 1));
          const ctrlX = lerp(startPos.x, endX, 0.5);
          const ctrlY = Math.min(startPos.y, endY) - cell * 1.6;
          const inv = 1 - p;
          const x = inv * inv * startPos.x + 2 * inv * p * ctrlX + p * p * endX;
          const y = inv * inv * startPos.y + 2 * inv * p * ctrlY + p * p * endY;
          const size = lerp(cell, slot, p);
          const color = targets.has(sorted[index].id) ? GREEN : GOLD;
          ctx.save();
          if (p >= 1 && backA > 0.5 && targets.has(sorted[index].id)) {
            ctx.shadowColor = color;
            ctx.shadowBlur = 10;
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            ctx.strokeRect(x - 1, y - 1, size + 2, size + 2);
          }
          drawSprite(ctx, index, x, y, size);
          ctx.restore();
        }

        if (overflow > 0 && backA > 0.4) {
          ctx.save();
          ctx.globalAlpha = backA;
          ctx.font = "800 12px ui-monospace, Menlo, monospace";
          ctx.fillStyle = INK;
          ctx.textBaseline = "middle";
          ctx.fillText(`+${overflow}`, stripX + stripW + 18, stripY + slot / 2);
          ctx.restore();
        }
        ctx.restore();
      }

      frame = requestAnimationFrame(draw);
    }

    let resolvePlay;
    const promise = new Promise((resolve) => {
      resolvePlay = resolve;
    });

    function finish() {
      if (done) return;
      done = true;
      cancelAnimationFrame(frame);
      clearTimeout(holdTimer);
      overlay.removeEventListener("pointerdown", onBackdrop);
      window.removeEventListener("keydown", onKey);
      overlay.style.opacity = "0";
      setTimeout(() => overlay.remove(), 180);
      active = null;
      resolvePlay(choice);
    }

    function dismiss() {
      if (done) return;
      if (actionsOpen && !released) choose("stay");
      else if (!released) finish();
    }

    function onBackdrop() {
      dismiss();
    }

    function onKey(event) {
      if (event.key === "Escape") {
        dismiss();
        return;
      }
      if (!actionsOpen || released) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        setSelected(selected === "view" ? "stay" : "view");
      } else if (event.key === "Enter") {
        event.preventDefault();
        choose(selected);
      }
    }

    function onAction(event, picked) {
      event.preventDefault();
      event.stopPropagation();
      choose(picked);
    }

    viewButton.addEventListener("pointerdown", (event) => onAction(event, "view"));
    stayButton.addEventListener("pointerdown", (event) => onAction(event, "stay"));
    viewButton.addEventListener("pointerenter", () => setSelected("view"));
    stayButton.addEventListener("pointerenter", () => setSelected("stay"));
    overlay.addEventListener("pointerdown", onBackdrop);
    window.addEventListener("keydown", onKey);
    active = { finish, dismiss };
    frame = requestAnimationFrame(draw);
    return promise;
  }

  window.GridFX = {
    play,
    dismiss: () => active?.dismiss(),
  };
})();
