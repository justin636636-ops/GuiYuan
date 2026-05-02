"use strict";

const GuiYuanRules = (() => {
  const COLORS = {
    red: { label: "赤", className: "red" },
    blue: { label: "青", className: "blue" },
    yellow: { label: "黄", className: "yellow" },
  };
  const COLOR_KEYS = Object.keys(COLORS);
  const VALUES = [1, 2, 3, 4, 5];
  const STRAIGHTS = [
    [1, 2, 3],
    [2, 3, 4],
    [3, 4, 5],
  ];
  const STORAGE_KEY = "guiyuan.bestScore";
  const SETTINGS_KEY = "guiyuan.settings";
  const ACTIVE_SAVE_KEY = "guiyuan.activeSave";
  const SAVE_VERSION = 1;
  const RNG_INCREMENT = 0x6d2b79f5;

  function stone(value, color, anchor = false) {
    return { value, color, anchor };
  }

  function cloneStone(item) {
    return item ? stone(item.value, item.color, Boolean(item.anchor)) : null;
  }

  function randomStone(rng = Math.random) {
    const value = VALUES[Math.floor(rng() * VALUES.length)];
    const color = COLOR_KEYS[Math.floor(rng() * COLOR_KEYS.length)];
    return stone(value, color);
  }

  function drawPair(rng = Math.random) {
    return [randomStone(rng), randomStone(rng)];
  }

  function isRngStateLike(value) {
    return Number.isFinite(value) && Math.floor(value) === value && value >= 0 && value <= 0xffffffff;
  }

  function makeRngSeed(seedSource = Math.random) {
    if (Number.isFinite(seedSource)) return Number(seedSource) >>> 0;

    const cryptoObj = typeof globalThis !== "undefined" ? globalThis.crypto : null;
    if (cryptoObj?.getRandomValues) {
      const buffer = new Uint32Array(1);
      cryptoObj.getRandomValues(buffer);
      return buffer[0] >>> 0;
    }

    const sourceValue = typeof seedSource === "function" ? seedSource() : Math.random();
    const randomPart = Math.floor((Number.isFinite(sourceValue) ? sourceValue : Math.random()) * 0x100000000) >>> 0;
    return ((Date.now() >>> 0) ^ randomPart ^ 0x9e3779b9) >>> 0;
  }

  function normalizeRngState(value, fallback = makeRngSeed()) {
    return isRngStateLike(value) ? value >>> 0 : fallback >>> 0;
  }

  function createRngController(initialState) {
    let rngState = normalizeRngState(initialState);
    return {
      next() {
        rngState = (rngState + RNG_INCREMENT) >>> 0;
        let t = rngState;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      },
      getState() {
        return rngState >>> 0;
      },
      setState(value) {
        rngState = normalizeRngState(value, rngState);
      },
      reseed(seedSource = Math.random) {
        rngState = makeRngSeed(seedSource);
      },
    };
  }

  function createState(bestScore = 0, rng = Math.random) {
    return {
      heart: 3,
      clarity: 0,
      turnCount: 0,
      bestScore,
      remnant: null,
      noMind: false,
      ascend: { slots: [] },
      descend: { slots: [] },
      center: { slots: [] },
      drawPair: [],
      setupPair: drawPair(rng),
      selectedIndex: null,
      phase: "setup",
      pendingTurn: null,
      pendingCallback: null,
      message: "择一息入中宫。",
      history: [],
    };
  }

  function colorLabel(color) {
    return COLORS[color]?.label || color;
  }

  function stoneName(item) {
    return `${colorLabel(item.color)}${item.value}`;
  }

  function addLog(state, message) {
    if (!message) return;
    state.message = message;
    state.history.unshift(message);
    state.history = state.history.slice(0, 5);
  }

  function startFromSetup(state, chosenIndex, rng = Math.random) {
    const chosen = cloneStone(state.setupPair[chosenIndex]);
    const unchosen = cloneStone(state.setupPair[1 - chosenIndex]);
    if (!chosen || !unchosen) return;

    state.heart = 3;
    state.clarity = 0;
    state.turnCount = 0;
    state.remnant = unchosen.value;
    state.noMind = false;
    state.ascend = { slots: [stone(1, chosen.color, true), null, null] };
    state.descend = { slots: [stone(5, unchosen.color, true), null, null] };
    state.center = { slots: [chosen, null, null] };
    state.selectedIndex = null;
    state.pendingTurn = null;
    state.pendingCallback = null;
    state.history = [];
    addLog(state, `${stoneName(chosen)}入中宫，余念为${unchosen.value}。`);
    beginTurn(state, rng);
  }

  function isBlockedByRemnant(state, item) {
    return state.remnant !== null && item.value === state.remnant;
  }

  function firstEmptyIndex(slots) {
    return slots.findIndex((slot) => slot === null);
  }

  function isAscendClosed(state) {
    return state.ascend.slots[0]?.value >= 4;
  }

  function isDescendClosed(state) {
    return state.descend.slots[0]?.value <= 2;
  }

  function canPlaceAscend(state, item) {
    if (isAscendClosed(state)) return false;
    const index = firstEmptyIndex(state.ascend.slots);
    if (index < 1) return false;
    if (item.value <= state.ascend.slots[index - 1].value) return false;
    return index !== 1 || item.value < 5;
  }

  function canPlaceDescend(state, item) {
    if (isDescendClosed(state)) return false;
    const index = firstEmptyIndex(state.descend.slots);
    if (index < 1) return false;
    if (item.value >= state.descend.slots[index - 1].value) return false;
    return index !== 1 || item.value > 1;
  }

  function countValues(values) {
    return values.reduce((counts, value) => {
      counts[value] = (counts[value] || 0) + 1;
      return counts;
    }, {});
  }

  function multisetContains(finalSet, partial) {
    const finalCounts = countValues(finalSet);
    const partialCounts = countValues(partial);
    return Object.keys(partialCounts).every((key) => partialCounts[key] <= (finalCounts[key] || 0));
  }

  function sameMultiset(a, b) {
    if (a.length !== b.length) return false;
    const countsA = countValues(a);
    const countsB = countValues(b);
    return VALUES.every((value) => (countsA[value] || 0) === (countsB[value] || 0));
  }

  function finalCenterSets() {
    const triplets = VALUES.map((value) => [value, value, value]);
    return triplets.concat(STRAIGHTS);
  }

  function canCenterValuesComplete(values) {
    if (values.length > 3) return false;
    if (values.length === 3) {
      return finalCenterSets().some((set) => sameMultiset(set, values));
    }
    return finalCenterSets().some((set) => multisetContains(set, values));
  }

  function canPlaceCenter(state, item) {
    const index = firstEmptyIndex(state.center.slots);
    if (index < 0) return false;
    const values = state.center.slots.filter(Boolean).map((slot) => slot.value).concat(item.value);
    return canCenterValuesComplete(values);
  }

  function legalTargets(state, item) {
    const targets = [];
    if (canPlaceAscend(state, item)) targets.push("ascend");
    if (canPlaceCenter(state, item)) targets.push("center");
    if (canPlaceDescend(state, item)) targets.push("descend");
    return targets;
  }

  function playableIndexes(state) {
    return state.drawPair
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item && !isBlockedByRemnant(state, item))
      .filter(({ item }) => legalTargets(state, item).length > 0)
      .map(({ index }) => index);
  }

  function loseHeartForWaste(state, reason) {
    state.heart -= 1;
    addLog(state, `${reason}，心息-1。`);
    if (state.heart <= 0) {
      endGame(state);
    }
  }

  function beginTurn(state, rng = Math.random) {
    if (state.heart <= 0) {
      endGame(state);
      return;
    }

    state.phase = "chooseStone";
    state.selectedIndex = null;
    state.pendingTurn = null;
    state.pendingCallback = null;
    state.turnCount = Number(state.turnCount || 0) + 1;
    state.drawPair = drawPair(rng);
    resolveDrawUntilPlayable(state, rng);
  }

  function resolveDrawUntilPlayable(state, rng = Math.random) {
    let guard = 0;
    while (state.phase !== "gameover" && guard < 20) {
      guard += 1;
      const blocked = state.drawPair.map((item) => isBlockedByRemnant(state, item));
      if (blocked.every(Boolean)) {
        loseHeartForWaste(state, `抽到${state.drawPair.map(stoneName).join(" / ")}，皆为余念`);
        if (state.phase === "gameover") return;
        state.drawPair = drawPair(rng);
        continue;
      }

      if (playableIndexes(state).length === 0) {
        loseHeartForWaste(state, `${state.drawPair.map(stoneName).join(" / ")}无处安放`);
        if (state.phase === "gameover") return;
        state.drawPair = drawPair(rng);
        continue;
      }
      state.phase = "chooseStone";
      return;
    }
  }

  function abandonDraw(state, rng = Math.random) {
    if (state.phase !== "chooseStone" || state.drawPair.length === 0 || state.heart <= 0) return;
    state.heart -= 1;
    state.selectedIndex = null;
    state.pendingTurn = null;
    state.pendingCallback = null;
    state.drawPair = [];
    addLog(state, "舍去本回合两息，心息-1。");
    if (state.heart <= 0) {
      endGame(state);
      return;
    }
    state.phase = "chooseStone";
    state.drawPair = drawPair(rng);
    resolveDrawUntilPlayable(state, rng);
  }

  function selectStone(state, index) {
    if (state.phase !== "chooseStone") return;
    const item = state.drawPair[index];
    if (!item) return;
    if (isBlockedByRemnant(state, item)) {
      addLog(state, `${stoneName(item)}触及余念，不能选择。`);
      return;
    }
    const targets = legalTargets(state, item);
    if (targets.length === 0) {
      addLog(state, `${stoneName(item)}无合法落点。`);
      return;
    }
    state.selectedIndex = index;
    state.phase = "chooseLane";
    addLog(state, `已选${stoneName(item)}，择一脉落子。`);
  }

  function placeSelected(state, laneName, rng = Math.random) {
    if (state.phase !== "chooseLane" || state.selectedIndex === null) return;
    const item = cloneStone(state.drawPair[state.selectedIndex]);
    const targets = legalTargets(state, item);
    if (!targets.includes(laneName)) {
      addLog(state, `${stoneName(item)}不可入此脉。`);
      return;
    }

    state.pendingTurn = {
      unselectedStone: cloneStone(state.drawPair[1 - state.selectedIndex]),
      harmony: false,
      notes: [],
    };

    const lane = state[laneName];
    const index = firstEmptyIndex(lane.slots);
    lane.slots[index] = item;
    state.drawPair = [];
    state.selectedIndex = null;

    if (firstEmptyIndex(lane.slots) === -1) {
      settleLane(state, laneName, rng);
      return;
    }

    addLog(state, `${stoneName(item)}入${laneDisplayName(laneName)}。`);
    finishTurn(state, rng);
  }

  function laneDisplayName(laneName) {
    return { ascend: "升脉", center: "中宫", descend: "降脉" }[laneName] || laneName;
  }

  function colorPattern(slots) {
    const colors = slots.map((slot) => slot.color);
    const unique = new Set(colors);
    if (unique.size === 1) return "cohesion";
    if (unique.size === 3) return "harmony";
    return "ordinary";
  }

  function patternLabel(pattern) {
    return { cohesion: "凝聚", harmony: "调和", ordinary: "普通" }[pattern];
  }

  function centerShape(slots) {
    const values = slots.map((slot) => slot.value);
    if (VALUES.some((value) => values.every((item) => item === value))) return "triplet";
    if (STRAIGHTS.some((set) => sameMultiset(set, values))) return "straight";
    return "invalid";
  }

  function settleLane(state, laneName, rng = Math.random) {
    if (laneName === "ascend" || laneName === "descend") {
      settleFlowLane(state, laneName, rng);
      return;
    }
    settleCenter(state, rng);
  }

  function markHarmony(state, pattern) {
    if (pattern === "harmony" && state.pendingTurn) {
      state.pendingTurn.harmony = true;
    }
  }

  function settleFlowLane(state, laneName, rng = Math.random) {
    const lane = state[laneName];
    const last = cloneStone(lane.slots[2]);
    const pattern = colorPattern(lane.slots);
    markHarmony(state, pattern);
    const reward = pattern === "cohesion" ? 2 : 1;
    state.clarity += reward;

    if (laneName === "ascend") {
      const nextValue = lane.slots[0].value + 1;
      state.ascend.slots = [stone(nextValue, last.color, true), null, null];
    } else {
      const nextValue = lane.slots[0].value - 1;
      state.descend.slots = [stone(nextValue, last.color, true), null, null];
    }

    addLog(state, `${laneDisplayName(laneName)}${patternLabel(pattern)}，清明+${reward}。`);
    finishTurn(state, rng);
  }

  function settleCenter(state, rng = Math.random) {
    const slots = state.center.slots.map(cloneStone);
    const shape = centerShape(slots);
    const pattern = colorPattern(slots);
    const last = cloneStone(slots[2]);
    markHarmony(state, pattern);
    state.center.slots = [null, null, null];

    if (shape === "triplet") {
      const strength = pattern === "cohesion" ? 2 : 1;
      state.pendingCallback = {
        strength,
        color: last.color,
        pattern,
      };
      state.phase = "callback";
      addLog(state, `中宫三条${patternLabel(pattern)}，请选择回调。`);
      return;
    }

    if (shape === "straight") {
      const heal = pattern === "cohesion" ? 2 : 1;
      const before = state.heart;
      state.heart = Math.min(3, state.heart + heal);
      addLog(state, `中宫顺子${patternLabel(pattern)}，心息+${state.heart - before}。`);
      finishTurn(state, rng);
      return;
    }

    addLog(state, "中宫未成形。");
    finishTurn(state, rng);
  }

  function applyCallback(state, laneName, rng = Math.random) {
    if (state.phase !== "callback" || !state.pendingCallback) return;
    const { strength, color } = state.pendingCallback;

    if (laneName === "ascend") {
      const current = state.ascend.slots[0].value;
      state.ascend.slots[0] = stone(Math.max(1, current - strength), color, true);
    } else if (laneName === "descend") {
      const current = state.descend.slots[0].value;
      state.descend.slots[0] = stone(Math.min(5, current + strength), color, true);
    } else {
      return;
    }

    addLog(state, `${laneDisplayName(laneName)}回调${strength}档。`);
    state.pendingCallback = null;
    finishTurn(state, rng);
  }

  function finishTurn(state, rng = Math.random) {
    const turn = state.pendingTurn;
    if (!turn) {
      beginTurn(state, rng);
      return;
    }

    if (turn.harmony) {
      state.remnant = null;
      state.noMind = true;
      addLog(state, "调和生效，余念清空，并得无念。");
    } else if (state.noMind) {
      state.remnant = null;
      state.noMind = false;
      addLog(state, "无念发动，本回合不生余念。");
    } else {
      state.remnant = turn.unselectedStone.value;
      addLog(state, `未选${stoneName(turn.unselectedStone)}化为余念${state.remnant}。`);
    }

    state.pendingTurn = null;
    beginTurn(state, rng);
  }

  function endGame(state) {
    state.phase = "gameover";
    state.drawPair = [];
    state.selectedIndex = null;
    state.pendingTurn = null;
    state.pendingCallback = null;
    state.bestScore = Math.max(state.bestScore || 0, state.clarity);
    addLog(state, `心息归零，清明止于${state.clarity}。`);
  }

  function loadBestScore() {
    try {
      return Number(window.localStorage.getItem(STORAGE_KEY) || 0);
    } catch (_error) {
      return 0;
    }
  }

  function snapshotState(state) {
    return JSON.parse(JSON.stringify(state));
  }

  function normalizeLoadedState(state, bestScore) {
    state.turnCount = Number.isFinite(state.turnCount) ? state.turnCount : 0;
    state.bestScore = Math.max(Number(state.bestScore || 0), bestScore);
    return state;
  }

  function snapshotUndo(state, rngState) {
    return {
      state: snapshotState(state),
      rngState: normalizeRngState(rngState),
    };
  }

  function isStoneLike(item) {
    return item === null || (VALUES.includes(item.value) && COLOR_KEYS.includes(item.color));
  }

  function isSlotArray(slots) {
    return Array.isArray(slots) && slots.length === 3 && slots.every(isStoneLike);
  }

  function isLaneSlotState(slots) {
    return (Array.isArray(slots) && slots.length === 0) || isSlotArray(slots);
  }

  function isStateLike(candidate) {
    const phases = ["setup", "chooseStone", "chooseLane", "callback", "gameover"];
    return Boolean(
      candidate &&
        phases.includes(candidate.phase) &&
        Number.isFinite(candidate.heart) &&
        Number.isFinite(candidate.clarity) &&
        Array.isArray(candidate.setupPair) &&
        Array.isArray(candidate.drawPair) &&
        candidate.ascend &&
        candidate.descend &&
        candidate.center &&
        isLaneSlotState(candidate.ascend.slots) &&
        isLaneSlotState(candidate.descend.slots) &&
        isLaneSlotState(candidate.center.slots)
    );
  }

  function parseUndoSnapshot(candidate, bestScore) {
    if (candidate?.state && isStateLike(candidate.state)) {
      return {
        state: normalizeLoadedState(candidate.state, bestScore),
        rngState: isRngStateLike(candidate.rngState) ? candidate.rngState >>> 0 : null,
      };
    }

    if (isStateLike(candidate)) {
      return {
        state: normalizeLoadedState(candidate, bestScore),
        rngState: null,
      };
    }

    return null;
  }

  function loadActiveSave(bestScore) {
    try {
      const raw = window.localStorage.getItem(ACTIVE_SAVE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed.version !== SAVE_VERSION || !isStateLike(parsed.state)) return null;
      if (parsed.state.phase === "gameover") return null;
      const undoSnapshot = parseUndoSnapshot(parsed.undoSnapshot, bestScore);
      return {
        state: normalizeLoadedState(parsed.state, bestScore),
        undoSnapshot,
        rngState: isRngStateLike(parsed.rngState) ? parsed.rngState >>> 0 : null,
      };
    } catch (_error) {
      return null;
    }
  }

  function persist(state, undoSnapshot = null, rngState = null) {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(state.bestScore || 0));
      window.localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({ fileShape: "three-files", drawModel: "infinite", assist: "strong", theme: "quiet-dark" })
      );
      if (state.phase === "gameover") {
        window.localStorage.removeItem(ACTIVE_SAVE_KEY);
      } else {
        window.localStorage.setItem(
          ACTIVE_SAVE_KEY,
          JSON.stringify({
            version: SAVE_VERSION,
            state: snapshotState(state),
            undoSnapshot,
            rngState: normalizeRngState(rngState),
          })
        );
      }
    } catch (_error) {
      /* Local storage can be unavailable in private contexts. */
    }
  }

  function clearActiveSave() {
    try {
      window.localStorage.removeItem(ACTIVE_SAVE_KEY);
    } catch (_error) {
      /* Local storage can be unavailable in private contexts. */
    }
  }

  function mount(documentRef, seedSource = Math.random) {
    const $ = (selector) => documentRef.querySelector(selector);
    const nodes = {
      undoButton: $("#undoButton"),
      abandonButton: $("#abandonButton"),
      heart: $("#heartValue"),
      clarity: $("#clarityValue"),
      turnCount: $("#turnValue"),
      remnant: $("#remnantValue"),
      noMind: $("#noMindValue"),
      phaseText: $("#phaseText"),
      primaryMessage: $("#primaryMessage"),
      historyList: $("#historyList"),
      drawPair: $("#drawPair"),
      setupPair: $("#setupPair"),
      setupOverlay: $("#setupOverlay"),
      callbackOverlay: $("#callbackOverlay"),
      gameOverOverlay: $("#gameOverOverlay"),
      callbackTitle: $("#callbackTitle"),
      callbackCopy: $("#callbackCopy"),
      finalScore: $("#finalScore"),
      bestScoreText: $("#bestScoreText"),
      lanes: {
        ascend: $("#ascendLane"),
        center: $("#centerLane"),
        descend: $("#descendLane"),
      },
      slots: {
        ascend: $("#ascendSlots"),
        center: $("#centerSlots"),
        descend: $("#descendSlots"),
      },
      notes: {
        ascend: $("#ascendNote"),
        center: $("#centerNote"),
        descend: $("#descendNote"),
      },
    };

    const bestScore = loadBestScore();
    const savedGame = loadActiveSave(bestScore);
    const rngController = createRngController(savedGame?.rngState ?? makeRngSeed(seedSource));
    const rng = () => rngController.next();
    let state = savedGame?.state || createState(bestScore, rng);
    let undoSnapshot = savedGame?.undoSnapshot || null;

    function createEnergyPhysics() {
      const reduceMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      const sims = new Map();
      let lastTime = 0;
      let frame = null;

      function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
      }

      function initStone(el) {
        const field = el.querySelector(".energy-field");
        const orbs = Array.from(el.querySelectorAll(".energy-orb"));
        const rect = el.getBoundingClientRect();
        const size = Math.min(rect.width, rect.height);
        if (!field || !orbs.length || size <= 0) return null;

        const value = Number(el.dataset.value || orbs.length);
        const orbRadius = clamp(size * 0.105, 5, 10);
        const boundaryRadius = size / 2 - orbRadius - 4;
        const center = size / 2;
        const speed = clamp(size * 0.3, 13, 27);
        const bodies = [];

        orbs.forEach((orb, index) => {
          const angle = value === 1 ? 0 : -Math.PI / 2 + (Math.PI * 2 * index) / value;
          const placementRadius = value === 1 ? 0 : boundaryRadius * (value <= 3 ? 0.48 : 0.62);
          const x = center + Math.cos(angle) * placementRadius;
          const y = center + Math.sin(angle) * placementRadius;
          const velocityAngle = angle + Math.PI / 2 + (index % 2 === 0 ? 0.22 : -0.22);
          const velocityScale = speed * (0.72 + index * 0.07);
          orb.style.width = `${orbRadius * 2}px`;
          orb.style.height = `${orbRadius * 2}px`;
          bodies.push({
            el: orb,
            x,
            y,
            vx: Math.cos(velocityAngle) * velocityScale,
            vy: Math.sin(velocityAngle) * velocityScale,
            r: orbRadius,
          });
        });

        const sim = { size, center, boundaryRadius, bodies };
        sims.set(el, sim);
        paintBodies(sim);
        return sim;
      }

      function paintBodies(sim) {
        sim.bodies.forEach((body) => {
          body.el.style.transform = `translate3d(${body.x - body.r}px, ${body.y - body.r}px, 0)`;
        });
      }

      function collideBodies(a, b) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.hypot(dx, dy) || 0.001;
        const minDistance = a.r + b.r + 1;
        if (distance >= minDistance) return;

        const nx = dx / distance;
        const ny = dy / distance;
        const overlap = (minDistance - distance) / 2;
        a.x -= nx * overlap;
        a.y -= ny * overlap;
        b.x += nx * overlap;
        b.y += ny * overlap;

        const relativeVelocityX = b.vx - a.vx;
        const relativeVelocityY = b.vy - a.vy;
        const impulse = relativeVelocityX * nx + relativeVelocityY * ny;
        if (impulse > 0) return;

        a.vx += impulse * nx;
        a.vy += impulse * ny;
        b.vx -= impulse * nx;
        b.vy -= impulse * ny;
      }

      function tick(time) {
        const dt = Math.min((time - lastTime) / 1000 || 0.016, 0.033);
        lastTime = time;
        const active = new Set(documentRef.querySelectorAll(".stone"));

        sims.forEach((_sim, el) => {
          if (!active.has(el) || !el.isConnected) sims.delete(el);
        });

        active.forEach((el) => {
          const rect = el.getBoundingClientRect();
          const size = Math.min(rect.width, rect.height);
          let sim = sims.get(el);
          if (!sim || Math.abs(sim.size - size) > 1 || sim.bodies.length !== Number(el.dataset.value || 0)) {
            sim = initStone(el);
          }
          if (!sim) return;

          sim.bodies.forEach((body) => {
            body.x += body.vx * dt;
            body.y += body.vy * dt;
            const dx = body.x - sim.center;
            const dy = body.y - sim.center;
            const distance = Math.hypot(dx, dy) || 0.001;
            if (distance > sim.boundaryRadius) {
              const nx = dx / distance;
              const ny = dy / distance;
              body.x = sim.center + nx * sim.boundaryRadius;
              body.y = sim.center + ny * sim.boundaryRadius;
              const dot = body.vx * nx + body.vy * ny;
              body.vx -= 2 * dot * nx;
              body.vy -= 2 * dot * ny;
            }
          });

          for (let i = 0; i < sim.bodies.length; i += 1) {
            for (let j = i + 1; j < sim.bodies.length; j += 1) {
              collideBodies(sim.bodies[i], sim.bodies[j]);
            }
          }
          paintBodies(sim);
        });

        frame = window.requestAnimationFrame(tick);
      }

      function sync() {
        const stones = Array.from(documentRef.querySelectorAll(".stone"));
        stones.forEach((el) => {
          if (!sims.has(el)) initStone(el);
        });
        if (!reduceMotion && frame === null && typeof window !== "undefined") {
          lastTime = performance.now();
          frame = window.requestAnimationFrame(tick);
        }
      }

      return { sync };
    }

    const energyPhysics = typeof window === "undefined" ? null : createEnergyPhysics();

    function captureUndo() {
      undoSnapshot = snapshotUndo(state, rngController.getState());
    }

    function resetGame() {
      undoSnapshot = null;
      clearActiveSave();
      rngController.reseed(seedSource);
      state = createState(state.bestScore || loadBestScore(), rng);
      render();
    }

    function undoLastAction() {
      if (!undoSnapshot || state.phase === "gameover") return;
      const restored = parseUndoSnapshot(undoSnapshot, state.bestScore || loadBestScore());
      if (!restored) return;
      state = snapshotState(restored.state);
      if (restored.rngState !== null) {
        rngController.setState(restored.rngState);
      }
      undoSnapshot = null;
      addLog(state, "已回到上一步。");
      render();
    }

    function renderStone(item, anchor = false) {
      const el = documentRef.createElement("span");
      el.className = `stone ${COLORS[item.color].className}${anchor || item.anchor ? " anchor" : ""}`;
      el.dataset.value = String(item.value);
      el.dataset.color = item.color;
      el.setAttribute("aria-label", stoneName(item));
      const field = documentRef.createElement("span");
      field.className = "energy-field";
      for (let i = 0; i < item.value; i += 1) {
        const orb = documentRef.createElement("span");
        orb.className = "energy-orb";
        field.appendChild(orb);
      }
      el.appendChild(field);
      return el;
    }

    function renderSlots(laneName) {
      const slotRoot = nodes.slots[laneName];
      slotRoot.textContent = "";
      state[laneName].slots.forEach((item, index) => {
        const slot = documentRef.createElement("span");
        slot.className = `slot${item ? " has-stone" : ""}`;
        if (item) slot.appendChild(renderStone(item, index === 0 && laneName !== "center"));
        slotRoot.appendChild(slot);
      });
    }

    function laneNote(laneName, selectedStone) {
      if (laneName === "ascend" && isAscendClosed(state)) return "脉闭";
      if (laneName === "descend" && isDescendClosed(state)) return "脉闭";
      if (!selectedStone || state.phase !== "chooseLane") return "";
      return legalTargets(state, selectedStone).includes(laneName) ? "可入" : "不可入";
    }

    function renderLanes() {
      const selectedStone = state.selectedIndex === null ? null : state.drawPair[state.selectedIndex];
      ["ascend", "center", "descend"].forEach((laneName) => {
        renderSlots(laneName);
        const lane = nodes.lanes[laneName];
        const legal = selectedStone && legalTargets(state, selectedStone).includes(laneName);
        lane.classList.toggle("is-legal", Boolean(legal));
        lane.classList.toggle("is-closed", laneName === "ascend" ? isAscendClosed(state) : laneName === "descend" ? isDescendClosed(state) : false);
        lane.disabled = state.phase !== "chooseLane" || !legal;
        nodes.notes[laneName].textContent = laneNote(laneName, selectedStone);
      });
    }

    function drawReason(item) {
      if (!item) return "";
      if (isBlockedByRemnant(state, item)) return "余念";
      if (legalTargets(state, item).length === 0) return "无处";
      if (state.phase === "chooseLane" && state.drawPair[state.selectedIndex] === item) return "已选";
      return "可选";
    }

    function renderStoneButton(item, index, context) {
      const button = documentRef.createElement("button");
      button.className = "stone-button";
      button.type = "button";
      button.appendChild(renderStone(item));

      const meta = documentRef.createElement("span");
      meta.className = "stone-meta";
      const name = documentRef.createElement("span");
      name.className = "stone-name";
      name.textContent = stoneName(item);
      const reason = documentRef.createElement("span");
      reason.className = "stone-reason";
      reason.textContent = context === "setup" ? (index === 0 ? "入中宫" : "入中宫") : drawReason(item);
      meta.append(name, reason);
      button.appendChild(meta);

      if (context === "setup") {
        button.addEventListener("click", () => {
          captureUndo();
          startFromSetup(state, index, rng);
          render();
        });
        return button;
      }

      const disabled = state.phase !== "chooseStone" || isBlockedByRemnant(state, item) || legalTargets(state, item).length === 0;
      button.disabled = disabled;
      button.classList.toggle("is-selected", state.selectedIndex === index);
      button.addEventListener("click", () => {
        captureUndo();
        selectStone(state, index);
        render();
      });
      return button;
    }

    function renderDrawPair() {
      nodes.drawPair.textContent = "";
      if (state.drawPair.length === 0) {
        const empty = documentRef.createElement("p");
        empty.className = "modal-copy";
        empty.textContent = state.phase === "setup" ? "开局中" : "待抽息";
        nodes.drawPair.appendChild(empty);
        return;
      }
      state.drawPair.forEach((item, index) => {
        nodes.drawPair.appendChild(renderStoneButton(item, index, "draw"));
      });
    }

    function renderSetup() {
      nodes.setupPair.textContent = "";
      state.setupPair.forEach((item, index) => {
        nodes.setupPair.appendChild(renderStoneButton(item, index, "setup"));
      });
      nodes.setupOverlay.classList.toggle("is-visible", state.phase === "setup");
    }

    function renderCallback() {
      const pending = state.pendingCallback;
      nodes.callbackOverlay.classList.toggle("is-visible", state.phase === "callback");
      if (!pending) return;
      nodes.callbackTitle.textContent = pending.strength === 2 ? "凝聚回调两档" : "回调一脉";
      nodes.callbackCopy.textContent = `新锚色为${colorLabel(pending.color)}。回调后仍保留该脉已填入的后续息珠。`;
    }

    function renderGameOver() {
      const visible = state.phase === "gameover";
      nodes.gameOverOverlay.classList.toggle("is-visible", visible);
      nodes.finalScore.textContent = state.clarity;
      nodes.bestScoreText.textContent = `最高纪录：${state.bestScore || 0}`;
    }

    function phaseText() {
      return {
        setup: "开局",
        chooseStone: "择息",
        chooseLane: "落脉",
        callback: "回调",
        gameover: "结束",
      }[state.phase];
    }

    function render() {
      nodes.heart.textContent = state.heart;
      nodes.clarity.textContent = state.clarity;
      nodes.turnCount.textContent = state.turnCount || 0;
      nodes.remnant.textContent = state.remnant === null ? "无" : state.remnant;
      nodes.noMind.textContent = state.noMind ? "有" : "无";
      nodes.phaseText.textContent = phaseText();
      nodes.primaryMessage.textContent = state.message;
      nodes.undoButton.disabled = !undoSnapshot || state.phase === "gameover";
      nodes.abandonButton.disabled = state.phase !== "chooseStone" || state.drawPair.length === 0 || state.heart <= 0;
      nodes.historyList.textContent = "";
      state.history.slice(1, 5).forEach((entry) => {
        const li = documentRef.createElement("li");
        li.textContent = entry;
        nodes.historyList.appendChild(li);
      });
      renderLanes();
      renderDrawPair();
      renderSetup();
      renderCallback();
      renderGameOver();
      energyPhysics?.sync();
      persist(state, undoSnapshot, rngController.getState());
    }

    Object.entries(nodes.lanes).forEach(([laneName, lane]) => {
      lane.addEventListener("click", () => {
        captureUndo();
        placeSelected(state, laneName, rng);
        render();
      });
    });

    $("#callbackAscend").addEventListener("click", () => {
      captureUndo();
      applyCallback(state, "ascend", rng);
      render();
    });
    $("#callbackDescend").addEventListener("click", () => {
      captureUndo();
      applyCallback(state, "descend", rng);
      render();
    });
    $("#undoButton").addEventListener("click", undoLastAction);
    $("#abandonButton").addEventListener("click", () => {
      captureUndo();
      abandonDraw(state, rng);
      render();
    });
    $("#restartButton").addEventListener("click", resetGame);
    $("#newGameButton").addEventListener("click", resetGame);

    render();
    return {
      getState: () => state,
      resetGame,
    };
  }

  return {
    COLORS,
    VALUES,
    createState,
    startFromSetup,
    beginTurn,
    abandonDraw,
    selectStone,
    placeSelected,
    applyCallback,
    canPlaceCenter,
    canCenterValuesComplete,
    canPlaceAscend,
    canPlaceDescend,
    legalTargets,
    centerShape,
    colorPattern,
    stone,
    stoneName,
    mount,
  };
})();

if (typeof module !== "undefined") {
  module.exports = GuiYuanRules;
}

if (typeof window !== "undefined") {
  window.GuiYuanRules = GuiYuanRules;
  window.addEventListener("DOMContentLoaded", () => {
    window.GuiYuan = GuiYuanRules.mount(document);
  });
}
