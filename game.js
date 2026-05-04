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
  const SEAL_TYPES = {
    ascend: { label: "升", fullLabel: "升印" },
    descend: { label: "降", fullLabel: "降印" },
    still: { label: "定", fullLabel: "定印" },
    flow: { label: "流", fullLabel: "流印" },
  };
  const SEAL_TYPE_KEYS = Object.keys(SEAL_TYPES);
  const GUIYUAN_SIZE = 3;
  const INITIAL_HEART = 3;
  const MAX_HEART = 4;
  const STORAGE_KEY = "guiyuan.bestScore";
  const SETTINGS_KEY = "guiyuan.settings";
  const ACTIVE_SAVE_KEY = "guiyuan.activeSave";
  const SCOREBOARD_KEY = "guiyuan.scoreboard";
  const SAVE_VERSION = 1;
  const SCOREBOARD_VERSION = 1;
  const RNG_INCREMENT = 0x6d2b79f5;
  const DEBUG_LOG_LIMIT = 300;

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

  function createRunStats() {
    return {
      drawCount: 0,
      turnDrawCount: 0,
      breathRedrawCount: 0,
      wasteRedrawCount: 0,
      breathCount: 0,
      wasteCount: 0,
      wasteByRemnant: 0,
      wasteByNoPlace: 0,
      heartLost: 0,
      heartLostByBreath: 0,
      heartLostByWaste: 0,
      placementCount: 0,
      ascendPlacements: 0,
      centerPlacements: 0,
      descendPlacements: 0,
      redPlacements: 0,
      bluePlacements: 0,
      yellowPlacements: 0,
      value1Placements: 0,
      value2Placements: 0,
      value3Placements: 0,
      value4Placements: 0,
      value5Placements: 0,
      ordinaryCount: 0,
      harmonyCount: 0,
      cohesionCount: 0,
      clarityGained: 0,
      cohesionBonusClarity: 0,
      heartHealEvents: 0,
      callbackCount: 0,
      callbackAscendCount: 0,
      callbackDescendCount: 0,
      callbackSteps: 0,
      heartHealed: 0,
      ascendSettles: 0,
      descendSettles: 0,
      centerTriplets: 0,
      centerStraights: 0,
      remnantGenerated: 0,
      remnantCleared: 0,
      noMindGained: 0,
      noMindUsed: 0,
      maxAscendAnchor: 0,
      minDescendAnchor: 0,
      ascendClosedCount: 0,
      descendClosedCount: 0,
    };
  }

  function createGuiyuanGrid() {
    return Array.from({ length: GUIYUAN_SIZE }, () => Array.from({ length: GUIYUAN_SIZE }, () => null));
  }

  function cloneSeal(seal) {
    return seal && SEAL_TYPE_KEYS.includes(seal.type) && COLOR_KEYS.includes(seal.color)
      ? { type: seal.type, color: seal.color }
      : null;
  }

  function cloneGuiyuanGrid(grid) {
    const normalized = normalizeGuiyuanGrid(grid);
    return normalized.map((row) => row.map(cloneSeal));
  }

  function normalizeGuiyuanGrid(grid) {
    const base = createGuiyuanGrid();
    if (!Array.isArray(grid)) return base;
    for (let y = 0; y < GUIYUAN_SIZE; y += 1) {
      if (!Array.isArray(grid[y])) continue;
      for (let x = 0; x < GUIYUAN_SIZE; x += 1) {
        base[y][x] = cloneSeal(grid[y][x]);
      }
    }
    return base;
  }

  function sealName(seal) {
    if (!seal) return "空";
    return `${colorLabel(seal.color)}${SEAL_TYPES[seal.type]?.fullLabel || "印"}`;
  }

  function sealShortName(seal) {
    if (!seal) return "_";
    return `${colorLabel(seal.color)}${SEAL_TYPES[seal.type]?.label || "印"}`;
  }

  function formatCoord(x, y) {
    return `(${x},${y})`;
  }

  function guiyuanSealCount(grid) {
    return normalizeGuiyuanGrid(grid).flat().filter(Boolean).length;
  }

  function isGuiyuanFull(grid) {
    return guiyuanSealCount(grid) >= GUIYUAN_SIZE * GUIYUAN_SIZE;
  }

  function isLegalSealPosition(state, x, y) {
    const grid = normalizeGuiyuanGrid(state.guiyuanGrid);
    if (x < 0 || x >= GUIYUAN_SIZE || y < 0 || y >= GUIYUAN_SIZE || grid[y][x]) return false;
    if (guiyuanSealCount(grid) === 0) return x === 0 && y === 2;
    return [
      [x, y - 1],
      [x + 1, y],
      [x, y + 1],
      [x - 1, y],
    ].some(([nx, ny]) => nx >= 0 && nx < GUIYUAN_SIZE && ny >= 0 && ny < GUIYUAN_SIZE && grid[ny][nx]);
  }

  function lineKindScore(items, key) {
    const unique = new Set(items.map((item) => item[key]));
    if (unique.size === 1) return key === "type" ? 6 : 3;
    if (unique.size === 3) return key === "type" ? 3 : 2;
    return key === "type" ? 1 : 0;
  }

  function calculateGuiyuanScore(grid) {
    const normalized = normalizeGuiyuanGrid(grid);
    const lines = [];
    for (let y = 0; y < GUIYUAN_SIZE; y += 1) {
      lines.push({ id: `row-${y}`, label: `第${y + 1}行`, cells: normalized[y] });
    }
    for (let x = 0; x < GUIYUAN_SIZE; x += 1) {
      lines.push({ id: `col-${x}`, label: `第${x + 1}列`, cells: normalized.map((row) => row[x]) });
    }

    const lineScores = lines.map((line) => {
      const complete = line.cells.every(Boolean);
      const typeScore = complete ? lineKindScore(line.cells, "type") : 0;
      const colorScore = complete ? lineKindScore(line.cells, "color") : 0;
      return {
        id: line.id,
        label: line.label,
        seals: line.cells.map(cloneSeal),
        complete,
        typeScore,
        colorScore,
        total: typeScore + colorScore,
      };
    });

    return {
      guiyuanScore: lineScores.reduce((sum, line) => sum + line.total, 0),
      lineScores,
    };
  }

  function formatLineScore(line) {
    const seals = line.seals.map(sealShortName).join("/");
    if (!line.complete) return `${line.label}：${seals}，未满不计分`;
    return `${line.label}：${seals}，印型${line.typeScore}+颜色${line.colorScore}=${line.total}`;
  }

  function typeScoreLabel(score) {
    return { 6: "同型6", 3: "异型3", 1: "杂型1" }[score] || `印型${score}`;
  }

  function colorScoreLabel(score) {
    return { 3: "同色3", 2: "异色2", 0: "杂色0" }[score] || `颜色${score}`;
  }

  function guiyuanLineIndex(lineId) {
    const [axis, rawIndex] = String(lineId).split("-");
    const index = Number(rawIndex);
    return axis === "col" ? GUIYUAN_SIZE + index : index;
  }

  function guiyuanLineColor(index) {
    return ["#ffd45a", "#58e6e8", "#ff6b5f", "#9bffbf", "#7fb6ff", "#ffb84a"][index % 6];
  }

  function normalizeGameOverReason(cause, heart) {
    const text = String(cause || "").trim();
    if (text) {
      const prefix = text.endsWith("。") ? text : `${text}。`;
      return heart <= 0 && !prefix.includes("心息归零") ? `${prefix}心息归零。` : prefix;
    }
    return heart <= 0 ? "心息归零。" : "本局结束。";
  }

  function normalizeRunStats(stats) {
    const base = createRunStats();
    if (!stats || typeof stats !== "object") return base;
    Object.keys(base).forEach((key) => {
      base[key] = Number.isFinite(stats[key]) ? Math.max(0, Math.floor(stats[key])) : 0;
    });
    return base;
  }

  function bumpRunStat(state, key, amount = 1) {
    state.runStats = normalizeRunStats(state.runStats);
    state.runStats[key] = (state.runStats[key] || 0) + amount;
  }

  function setRunStatMax(state, key, value) {
    if (!Number.isFinite(value)) return;
    state.runStats = normalizeRunStats(state.runStats);
    state.runStats[key] = Math.max(state.runStats[key] || 0, Math.floor(value));
  }

  function setRunStatMinPositive(state, key, value) {
    if (!Number.isFinite(value)) return;
    state.runStats = normalizeRunStats(state.runStats);
    const next = Math.floor(value);
    state.runStats[key] = state.runStats[key] > 0 ? Math.min(state.runStats[key], next) : next;
  }

  function trackDraw(state, kind) {
    bumpRunStat(state, "drawCount");
    if (kind === "turn") bumpRunStat(state, "turnDrawCount");
    if (kind === "breath") bumpRunStat(state, "breathRedrawCount");
    if (kind === "waste") bumpRunStat(state, "wasteRedrawCount");
  }

  function trackAnchorExtremes(state) {
    setRunStatMax(state, "maxAscendAnchor", state.ascend?.slots?.[0]?.value);
    setRunStatMinPositive(state, "minDescendAnchor", state.descend?.slots?.[0]?.value);
  }

  function trackPlacement(state, laneName, item) {
    bumpRunStat(state, "placementCount");
    bumpRunStat(state, `${laneName}Placements`);
    if (COLORS[item.color]) bumpRunStat(state, `${item.color}Placements`);
    if (VALUES.includes(item.value)) bumpRunStat(state, `value${item.value}Placements`);
  }

  function trackPattern(state, pattern) {
    if (pattern === "harmony") bumpRunStat(state, "harmonyCount");
    else if (pattern === "cohesion") bumpRunStat(state, "cohesionCount");
    else bumpRunStat(state, "ordinaryCount");
  }

  function createState(bestScore = 0, rng = Math.random) {
    return {
      heart: INITIAL_HEART,
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
      pendingSeal: null,
      pendingWaste: null,
      guiyuanGrid: createGuiyuanGrid(),
      guiyuanScore: 0,
      finalScore: 0,
      lineScores: [],
      runStats: createRunStats(),
      startedAt: Date.now(),
      scoreRecorded: false,
      message: "择一息入中宫。",
      history: [],
      debugLog: [],
    };
  }

  function colorLabel(color) {
    return COLORS[color]?.label || color;
  }

  function stoneName(item) {
    return `${colorLabel(item.color)}${item.value}`;
  }

  function formatDebugStone(item) {
    if (!item) return "_";
    return `${colorLabel(item.color)}${item.value}${item.anchor ? "*" : ""}`;
  }

  function formatDebugSlots(slots) {
    if (!Array.isArray(slots) || slots.length === 0) return "[]";
    return `[${slots.map(formatDebugStone).join(",")}]`;
  }

  function createDebugSnapshot(state) {
    return {
      heart: state.heart,
      clarity: state.clarity,
      turn: Number(state.turnCount || 0),
      remnant: state.remnant,
      noMind: Boolean(state.noMind),
      phase: state.phase,
      ascend: formatDebugSlots(state.ascend?.slots),
      center: formatDebugSlots(state.center?.slots),
      descend: formatDebugSlots(state.descend?.slots),
      draw: Array.isArray(state.drawPair) ? state.drawPair.map(formatDebugStone).join("/") : "",
      selected: state.selectedIndex === null || state.selectedIndex === undefined ? "-" : state.selectedIndex,
      callback: state.pendingCallback ? `${state.pendingCallback.strength}档/${colorLabel(state.pendingCallback.color)}` : "-",
      seal: state.pendingSeal ? sealName(state.pendingSeal.seal) : "-",
    };
  }

  function formatDebugSnapshot(snapshot) {
    return `心${snapshot.heart} 清${snapshot.clarity} 周${snapshot.turn} 余${snapshot.remnant ?? "无"} 无${snapshot.noMind ? "有" : "无"} | 升${snapshot.ascend} 中${snapshot.center} 降${snapshot.descend} | 抽${snapshot.draw || "-"} 选${snapshot.selected} 回${snapshot.callback} 印${snapshot.seal || "-"}`;
  }

  function formatRecordLane(slots) {
    return Array.isArray(slots) ? slots.map(formatDebugStone).join(" / ") : "";
  }

  function normalizeDebugLog(log) {
    return Array.isArray(log) ? log.filter((entry) => entry && entry.text).slice(0, DEBUG_LOG_LIMIT) : [];
  }

  function addDebugLog(state, message, type = "debug") {
    if (!message) return;
    state.debugLog = normalizeDebugLog(state.debugLog);
    const nextSeq = Number(state.debugLog[0]?.seq || 0) + 1;
    state.debugLog.unshift({
      id: `log-${nextSeq}`,
      seq: nextSeq,
      turn: Number(state.turnCount || 0),
      phase: state.phase,
      type,
      text: message,
      snapshot: createDebugSnapshot(state),
    });
    state.debugLog = state.debugLog.slice(0, DEBUG_LOG_LIMIT);
  }

  function addLog(state, message, type = "rule") {
    if (!message) return;
    state.message = message;
    state.history.unshift(message);
    state.history = state.history.slice(0, 5);
    addDebugLog(state, message, type);
  }

  function startFromSetup(state, chosenIndex, rng = Math.random) {
    const chosen = cloneStone(state.setupPair[chosenIndex]);
    const unchosen = cloneStone(state.setupPair[1 - chosenIndex]);
    if (!chosen || !unchosen) return;

    state.heart = INITIAL_HEART;
    state.clarity = 0;
    state.turnCount = 0;
    state.remnant = unchosen.value;
    state.noMind = false;
    state.ascend = { slots: [stone(2, chosen.color, true), null, null] };
    state.descend = { slots: [stone(4, unchosen.color, true), null, null] };
    state.center = { slots: [chosen, null, null] };
    state.selectedIndex = null;
    state.pendingTurn = null;
    state.pendingCallback = null;
    state.pendingSeal = null;
    state.pendingWaste = null;
    state.guiyuanGrid = createGuiyuanGrid();
    state.guiyuanScore = 0;
    state.finalScore = 0;
    state.lineScores = [];
    state.runStats = createRunStats();
    state.startedAt = Date.now();
    state.scoreRecorded = false;
    state.history = [];
    state.debugLog = [];
    trackAnchorExtremes(state);
    trackPlacement(state, "center", chosen);
    addLog(state, `开局选择${stoneName(chosen)}入中宫，${stoneName(unchosen)}化为余念${unchosen.value}。`, "setup");
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
    bumpRunStat(state, "wasteCount");
    bumpRunStat(state, "heartLost");
    bumpRunStat(state, "heartLostByWaste");
    if (reason.includes("皆为余念")) bumpRunStat(state, "wasteByRemnant");
    if (reason.includes("无处安放")) bumpRunStat(state, "wasteByNoPlace");
    state.pendingWaste = { reason };
    if (state.heart <= 0) {
      endGame(state, `${reason}，断息心息-1。`);
      return;
    }
    state.phase = "waste";
    state.selectedIndex = null;
    state.pendingTurn = null;
    state.pendingCallback = null;
    addLog(state, `${reason}，断息心息-1。点继续重新抽息。`, "waste");
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
    state.pendingWaste = null;
    state.turnCount = Number(state.turnCount || 0) + 1;
    state.drawPair = drawPair(rng);
    trackDraw(state, "turn");
    resolveDrawUntilPlayable(state, rng);
    if (state.phase !== "gameover") {
      addDebugLog(state, `息周${state.turnCount}抽到${state.drawPair.map(stoneName).join(" / ")}。`, "draw");
    }
  }

  function resolveDrawUntilPlayable(state, rng = Math.random) {
    if (state.phase === "gameover") return;
    const blocked = state.drawPair.map((item) => isBlockedByRemnant(state, item));
    if (blocked.every(Boolean)) {
      loseHeartForWaste(state, `抽到${state.drawPair.map(stoneName).join(" / ")}，皆为余念`);
      return;
    }

    if (playableIndexes(state).length === 0) {
      loseHeartForWaste(state, `${state.drawPair.map(stoneName).join(" / ")}无处安放`);
      return;
    }
    state.pendingWaste = null;
    state.phase = "chooseStone";
  }

  function continueAfterWaste(state, rng = Math.random) {
    if (state.phase !== "waste" || state.heart <= 0) return;
    state.pendingWaste = null;
    state.selectedIndex = null;
    state.pendingTurn = null;
    state.pendingCallback = null;
    state.phase = "chooseStone";
    state.drawPair = drawPair(rng);
    trackDraw(state, "waste");
    addDebugLog(state, `断息后继续调息，重新抽到${state.drawPair.map(stoneName).join(" / ")}。`, "draw");
    resolveDrawUntilPlayable(state, rng);
    if (state.phase === "chooseStone") {
      addLog(state, `重新抽到${state.drawPair.map(stoneName).join(" / ")}，择一息。`, "draw");
    }
  }

  function abandonDraw(state, rng = Math.random) {
    if (state.phase !== "chooseStone" || state.drawPair.length === 0 || state.heart <= 0) return;
    state.heart -= 1;
    bumpRunStat(state, "breathCount");
    bumpRunStat(state, "heartLost");
    bumpRunStat(state, "heartLostByBreath");
    state.selectedIndex = null;
    state.pendingTurn = null;
    state.pendingCallback = null;
    state.pendingWaste = null;
    state.drawPair = [];
    addLog(state, "换气重抽，心息-1。", "player");
    if (state.heart <= 0) {
      endGame(state);
      return;
    }
    state.phase = "chooseStone";
    state.drawPair = drawPair(rng);
    trackDraw(state, "breath");
    resolveDrawUntilPlayable(state, rng);
  }

  function selectStone(state, index) {
    if (state.phase !== "chooseStone") return;
    const item = state.drawPair[index];
    if (!item) return;
    if (isBlockedByRemnant(state, item)) {
      addLog(state, `${stoneName(item)}触及余念，不能选择。`, "blocked");
      return;
    }
    const targets = legalTargets(state, item);
    if (targets.length === 0) {
      addLog(state, `${stoneName(item)}无合法落点。`, "blocked");
      return;
    }
    state.selectedIndex = index;
    state.phase = "chooseLane";
    addLog(state, `已选${stoneName(item)}，择一脉落子。`, "player");
  }

  function placeSelected(state, laneName, rng = Math.random) {
    if (state.phase !== "chooseLane" || state.selectedIndex === null) return;
    const item = cloneStone(state.drawPair[state.selectedIndex]);
    const targets = legalTargets(state, item);
    if (!targets.includes(laneName)) {
      addLog(state, `${stoneName(item)}不可入此脉。`, "blocked");
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
    trackPlacement(state, laneName, item);
    state.drawPair = [];
    state.selectedIndex = null;

    if (firstEmptyIndex(lane.slots) === -1) {
      settleLane(state, laneName, rng);
      return;
    }

    addLog(state, `${stoneName(item)}入${laneDisplayName(laneName)}。`, "player");
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

  function patternRuleLabel(pattern) {
    return { cohesion: "三色同", harmony: "三不同", ordinary: "杂色" }[pattern] || patternLabel(pattern);
  }

  function colorMultiplier(pattern) {
    return { cohesion: 3, harmony: 2, ordinary: 1 }[pattern] || 1;
  }

  function harmonyLogSuffix(pattern) {
    return pattern === "harmony" ? "，并触发调和" : "";
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

  function makeSeal(type, color) {
    return { type, color };
  }

  function enterCallback(state) {
    if (!state.pendingCallback) return;
    state.phase = "callback";
    addLog(state, `中宫三条${patternRuleLabel(state.pendingCallback.pattern)}，请选择回调。`, "settle");
  }

  function endGameByGuiyuanFull(state) {
    endGame(state, "归元图填满。");
  }

  function placeSealAt(state, seal, x, y, automatic = false) {
    state.guiyuanGrid = normalizeGuiyuanGrid(state.guiyuanGrid);
    if (!isLegalSealPosition(state, x, y)) return false;
    state.guiyuanGrid[y][x] = cloneSeal(seal);
    addLog(state, `${automatic ? "首枚" : ""}${sealName(seal)}入归元图${formatCoord(x, y)}。`, "seal");
    if (isGuiyuanFull(state.guiyuanGrid)) {
      endGameByGuiyuanFull(state);
      return true;
    }
    return true;
  }

  function queueSeal(state, type, color, nextStep = "finishTurn") {
    const seal = makeSeal(type, color);
    state.guiyuanGrid = normalizeGuiyuanGrid(state.guiyuanGrid);
    const count = guiyuanSealCount(state.guiyuanGrid);
    addDebugLog(state, `本次结算产生${sealName(seal)}。`, "seal");
    if (count === 0) {
      placeSealAt(state, seal, 0, 2, true);
      return state.phase === "gameover";
    }

    state.pendingSeal = { seal, nextStep };
    state.phase = "placeSeal";
    addLog(state, `产生${sealName(seal)}，请选择归元图空位。`, "seal");
    return true;
  }

  function continueAfterSeal(state, rng = Math.random) {
    const nextStep = state.pendingSeal?.nextStep || "finishTurn";
    state.pendingSeal = null;
    if (state.phase === "gameover") return;
    if (nextStep === "callback") {
      enterCallback(state);
      return;
    }
    finishTurn(state, rng);
  }

  function placePendingSeal(state, x, y, rng = Math.random) {
    if (state.phase !== "placeSeal" || !state.pendingSeal) return;
    const { seal } = state.pendingSeal;
    if (!placeSealAt(state, seal, x, y, false)) {
      addLog(state, `${formatCoord(x, y)}不可安印。`, "blocked");
      return;
    }
    continueAfterSeal(state, rng);
  }

  function settleFlowLane(state, laneName, rng = Math.random) {
    const lane = state[laneName];
    const last = cloneStone(lane.slots[2]);
    const pattern = colorPattern(lane.slots);
    const initialValue = lane.slots[0].value;
    const baseScore = laneName === "ascend" ? initialValue : 6 - initialValue;
    const multiplier = colorMultiplier(pattern);
    const reward = baseScore * multiplier;
    markHarmony(state, pattern);
    trackPattern(state, pattern);
    bumpRunStat(state, laneName === "ascend" ? "ascendSettles" : "descendSettles");
    state.clarity += reward;
    bumpRunStat(state, "clarityGained", reward);

    if (laneName === "ascend") {
      const nextValue = initialValue + 1;
      state.ascend.slots = [stone(nextValue, last.color, true), null, null];
      setRunStatMax(state, "maxAscendAnchor", nextValue);
      if (nextValue >= 4) bumpRunStat(state, "ascendClosedCount");
    } else {
      const nextValue = initialValue - 1;
      state.descend.slots = [stone(nextValue, last.color, true), null, null];
      setRunStatMinPositive(state, "minDescendAnchor", nextValue);
      if (nextValue <= 2) bumpRunStat(state, "descendClosedCount");
    }

    addLog(
      state,
      `${laneDisplayName(laneName)}贯通：初始值 ${initialValue}，基础分 ${baseScore}，${patternRuleLabel(pattern)} ×${multiplier}，获得 ${reward} 清明${harmonyLogSuffix(pattern)}。`,
      "settle"
    );
    const sealType = laneName === "ascend" ? "ascend" : "descend";
    if (queueSeal(state, sealType, last.color, "finishTurn")) return;
    finishTurn(state, rng);
  }

  function settleCenter(state, rng = Math.random) {
    const slots = state.center.slots.map(cloneStone);
    const shape = centerShape(slots);
    const pattern = colorPattern(slots);
    const last = cloneStone(slots[2]);
    markHarmony(state, pattern);
    trackPattern(state, pattern);
    state.center.slots = [null, null, null];

    if (shape === "triplet") {
      bumpRunStat(state, "centerTriplets");
      const multiplier = colorMultiplier(pattern);
      const strength = multiplier;
      state.pendingCallback = {
        strength,
        color: last.color,
        pattern,
      };
      addLog(
        state,
        `中宫三条：基础回调 1，${patternRuleLabel(pattern)} ×${multiplier}，回调 ${strength} 档${harmonyLogSuffix(pattern)}。回调前先安定印。`,
        "settle"
      );
      if (queueSeal(state, "still", last.color, "callback")) return;
      enterCallback(state);
      return;
    }

    if (shape === "straight") {
      bumpRunStat(state, "centerStraights");
      const multiplier = colorMultiplier(pattern);
      const heal = multiplier;
      const before = state.heart;
      state.heart = Math.min(MAX_HEART, state.heart + heal);
      const healed = state.heart - before;
      if (healed > 0) bumpRunStat(state, "heartHealEvents");
      bumpRunStat(state, "heartHealed", healed);
      addLog(
        state,
        `中宫顺子：基础回复 1，${patternRuleLabel(pattern)} ×${multiplier}，回复 ${heal} 心息，实际回复 ${healed}${harmonyLogSuffix(pattern)}。`,
        "settle"
      );
      if (queueSeal(state, "flow", last.color, "finishTurn")) return;
      finishTurn(state, rng);
      return;
    }

    addLog(state, "中宫未成形。", "settle");
    finishTurn(state, rng);
  }

  function applyCallback(state, laneName, rng = Math.random) {
    if (state.phase !== "callback" || !state.pendingCallback) return;
    const { strength, color } = state.pendingCallback;

    if (laneName === "ascend") {
      const current = state.ascend.slots[0].value;
      state.ascend.slots[0] = stone(Math.max(1, current - strength), color, true);
      bumpRunStat(state, "callbackAscendCount");
    } else if (laneName === "descend") {
      const current = state.descend.slots[0].value;
      state.descend.slots[0] = stone(Math.min(5, current + strength), color, true);
      bumpRunStat(state, "callbackDescendCount");
    } else {
      return;
    }

    addLog(state, `${laneDisplayName(laneName)}回调${strength}档。`, "player");
    bumpRunStat(state, "callbackCount");
    bumpRunStat(state, "callbackSteps", strength);
    trackAnchorExtremes(state);
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
      if (state.remnant !== null) bumpRunStat(state, "remnantCleared");
      bumpRunStat(state, "noMindGained");
      state.remnant = null;
      state.noMind = true;
      addLog(state, "调和生效，余念清空，并得无念。", "harmony");
    } else if (state.noMind) {
      bumpRunStat(state, "noMindUsed");
      state.remnant = null;
      state.noMind = false;
      addLog(state, "无念发动，本回合不生余念。", "noMind");
    } else {
      bumpRunStat(state, "remnantGenerated");
      state.remnant = turn.unselectedStone.value;
      addLog(state, `未选${stoneName(turn.unselectedStone)}化为余念${state.remnant}。`, "remnant");
    }

    state.pendingTurn = null;
    beginTurn(state, rng);
  }

  function endGame(state, cause = "") {
    if (state.phase === "gameover" && state.scoreRecorded) return;
    const scoreResult = calculateGuiyuanScore(state.guiyuanGrid);
    state.guiyuanScore = scoreResult.guiyuanScore;
    state.lineScores = scoreResult.lineScores;
    state.finalScore = Number(state.clarity || 0) + state.guiyuanScore;
    const previousBest = state.bestScore || 0;
    state.phase = "gameover";
    state.selectedIndex = null;
    state.pendingTurn = null;
    state.pendingCallback = null;
    state.pendingSeal = null;
    state.pendingWaste = null;
    state.bestScore = Math.max(state.bestScore || 0, state.finalScore);
    appendScoreRecord(state, cause, previousBest);
    const reason = normalizeGameOverReason(cause, state.heart);
    addLog(state, `${reason}最终总分${state.finalScore}（清明${state.clarity}+归元图${state.guiyuanScore}）。`, "gameover");
    state.lineScores.forEach((line) => addDebugLog(state, formatLineScore(line), "score"));
  }

  function loadBestScore() {
    try {
      return Number(window.localStorage.getItem(STORAGE_KEY) || 0);
    } catch (_error) {
      return 0;
    }
  }

  function normalizeScoreRecord(record) {
    if (!record || typeof record !== "object") return null;
    const clarity = Number(record.clarity);
    const turnCount = Number(record.turnCount);
    if (!Number.isFinite(clarity) || !Number.isFinite(turnCount)) return null;
    const startedAt = Number(record.startedAt || record.endedAt || Date.now());
    const endedAt = Number(record.endedAt || Date.now());
    const durationMs = Number.isFinite(Number(record.durationMs))
      ? Math.max(0, Number(record.durationMs))
      : Math.max(0, endedAt - startedAt);
    const lanes = record.lanes && typeof record.lanes === "object" ? record.lanes : {};
    const finalAnchors = record.finalAnchors && typeof record.finalAnchors === "object" ? record.finalAnchors : {};
    const guiyuanGrid = normalizeGuiyuanGrid(record.guiyuanGrid);
    const calculated = calculateGuiyuanScore(guiyuanGrid);
    const guiyuanScore = Number.isFinite(Number(record.guiyuanScore)) ? Math.max(0, Number(record.guiyuanScore)) : calculated.guiyuanScore;
    const finalScore = Number.isFinite(Number(record.finalScore)) ? Math.max(0, Number(record.finalScore)) : clarity + guiyuanScore;
    return {
      id: String(record.id || `score-${record.endedAt || Date.now()}`),
      startedAt,
      endedAt,
      durationMs,
      finalScore,
      clarity,
      guiyuanScore,
      lineScores: calculated.lineScores,
      guiyuanGrid,
      turnCount,
      endingReason: String(record.endingReason || "心息归零"),
      previousBest: Number(record.previousBest || 0),
      isNewBest: Boolean(record.isNewBest),
      remnant: record.remnant ?? null,
      noMind: Boolean(record.noMind),
      runStats: normalizeRunStats(record.runStats),
      lanes: {
        ascend: String(lanes.ascend || ""),
        center: String(lanes.center || ""),
        descend: String(lanes.descend || ""),
      },
      finalAnchors: {
        ascend: finalAnchors.ascend ?? null,
        descend: finalAnchors.descend ?? null,
      },
    };
  }

  function loadScoreboardRecords() {
    try {
      const raw = window.localStorage.getItem(SCOREBOARD_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (parsed.version !== SCOREBOARD_VERSION || !Array.isArray(parsed.records)) return [];
      return parsed.records.map(normalizeScoreRecord).filter(Boolean);
    } catch (_error) {
      return [];
    }
  }

  function saveScoreboardRecords(records) {
    try {
      window.localStorage.setItem(SCOREBOARD_KEY, JSON.stringify({ version: SCOREBOARD_VERSION, records }));
    } catch (_error) {
      /* Local storage can be unavailable or full. */
    }
  }

  function createScoreRecord(state, cause, previousBest) {
    const endedAt = Date.now();
    const startedAt = Number(state.startedAt || endedAt);
    const endingReason = normalizeGameOverReason(cause, state.heart).replace(/。$/, "");
    return {
      id: `score-${endedAt}-${Math.random().toString(36).slice(2, 8)}`,
      startedAt,
      endedAt,
      durationMs: Math.max(0, endedAt - startedAt),
      finalScore: state.finalScore,
      clarity: state.clarity,
      guiyuanScore: state.guiyuanScore,
      lineScores: Array.isArray(state.lineScores) ? state.lineScores : [],
      guiyuanGrid: cloneGuiyuanGrid(state.guiyuanGrid),
      turnCount: Number(state.turnCount || 0),
      endingReason,
      previousBest,
      isNewBest: state.finalScore > previousBest,
      remnant: state.remnant,
      noMind: Boolean(state.noMind),
      runStats: normalizeRunStats(state.runStats),
      lanes: {
        ascend: formatRecordLane(state.ascend?.slots),
        center: formatRecordLane(state.center?.slots),
        descend: formatRecordLane(state.descend?.slots),
      },
      finalAnchors: {
        ascend: state.ascend?.slots?.[0]?.value ?? null,
        descend: state.descend?.slots?.[0]?.value ?? null,
      },
    };
  }

  function appendScoreRecord(state, cause, previousBest) {
    if (state.scoreRecorded) return;
    const records = loadScoreboardRecords();
    records.push(createScoreRecord(state, cause, previousBest));
    saveScoreboardRecords(records);
    state.scoreRecorded = true;
  }

  function snapshotState(state) {
    return JSON.parse(JSON.stringify(state));
  }

  function normalizeLoadedState(state, bestScore) {
    state.turnCount = Number.isFinite(state.turnCount) ? state.turnCount : 0;
    state.bestScore = Math.max(Number(state.bestScore || 0), bestScore);
    state.history = Array.isArray(state.history) ? state.history.slice(0, 5) : [];
    state.debugLog = normalizeDebugLog(state.debugLog);
    state.pendingWaste = state.pendingWaste && typeof state.pendingWaste.reason === "string" ? state.pendingWaste : null;
    state.pendingSeal = normalizePendingSeal(state.pendingSeal);
    if (state.phase === "placeSeal" && !state.pendingSeal) state.phase = "chooseStone";
    state.guiyuanGrid = normalizeGuiyuanGrid(state.guiyuanGrid);
    const scoreResult = calculateGuiyuanScore(state.guiyuanGrid);
    state.guiyuanScore = Number.isFinite(state.guiyuanScore) ? state.guiyuanScore : scoreResult.guiyuanScore;
    state.finalScore = Number.isFinite(state.finalScore) ? state.finalScore : Number(state.clarity || 0) + state.guiyuanScore;
    state.lineScores = Array.isArray(state.lineScores) ? state.lineScores : scoreResult.lineScores;
    state.runStats = normalizeRunStats(state.runStats);
    state.startedAt = Number.isFinite(state.startedAt) ? state.startedAt : Date.now();
    state.scoreRecorded = Boolean(state.scoreRecorded);
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

  function isSealLike(item) {
    return item === null || (SEAL_TYPE_KEYS.includes(item.type) && COLOR_KEYS.includes(item.color));
  }

  function isGuiyuanGridLike(grid) {
    return (
      Array.isArray(grid) &&
      grid.length === GUIYUAN_SIZE &&
      grid.every((row) => Array.isArray(row) && row.length === GUIYUAN_SIZE && row.every(isSealLike))
    );
  }

  function normalizePendingSeal(pendingSeal) {
    if (!pendingSeal || typeof pendingSeal !== "object") return null;
    const seal = cloneSeal(pendingSeal.seal);
    if (!seal) return null;
    return {
      seal,
      nextStep: pendingSeal.nextStep === "callback" ? "callback" : "finishTurn",
    };
  }

  function isSlotArray(slots) {
    return Array.isArray(slots) && slots.length === 3 && slots.every(isStoneLike);
  }

  function isLaneSlotState(slots) {
    return (Array.isArray(slots) && slots.length === 0) || isSlotArray(slots);
  }

  function isStateLike(candidate) {
    const phases = ["setup", "chooseStone", "chooseLane", "placeSeal", "callback", "waste", "gameover"];
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
        isLaneSlotState(candidate.center.slots) &&
        (!candidate.guiyuanGrid || isGuiyuanGridLike(candidate.guiyuanGrid))
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
      window.localStorage.setItem(
        ACTIVE_SAVE_KEY,
        JSON.stringify({
          version: SAVE_VERSION,
          state: snapshotState(state),
          undoSnapshot,
          rngState: normalizeRngState(rngState),
        })
      );
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
      scoreboardButton: $("#scoreboardButton"),
      rulesButton: $("#rulesButton"),
      logButton: $("#logButton"),
      minimizedDock: $("#minimizedDock"),
      minimizedDockLabel: $("#minimizedDockLabel"),
      restoreOverlayButton: $("#restoreOverlayButton"),
      undoButton: $("#undoButton"),
      abandonButton: $("#abandonButton"),
      heart: $("#heartValue"),
      clarity: $("#clarityValue"),
      turnCount: $("#turnValue"),
      remnant: $("#remnantValue"),
      noMind: $("#noMindValue"),
      phaseText: $("#phaseText"),
      pendingSealText: $("#pendingSealText"),
      guiyuanGrid: $("#guiyuanGrid"),
      primaryMessage: $("#primaryMessage"),
      historyList: $("#historyList"),
      drawPair: $("#drawPair"),
      setupPair: $("#setupPair"),
      setupOverlay: $("#setupOverlay"),
      scoreboardOverlay: $("#scoreboardOverlay"),
      scoreboardContent: $("#scoreboardContent"),
      rulesOverlay: $("#rulesOverlay"),
      logOverlay: $("#logOverlay"),
      logList: $("#logList"),
      callbackOverlay: $("#callbackOverlay"),
      gameOverOverlay: $("#gameOverOverlay"),
      closeScoreboardButton: $("#closeScoreboardButton"),
      closeScoreboardActionButton: $("#closeScoreboardActionButton"),
      closeRulesButton: $("#closeRulesButton"),
      closeRulesActionButton: $("#closeRulesActionButton"),
      closeLogButton: $("#closeLogButton"),
      closeLogActionButton: $("#closeLogActionButton"),
      clearLogButton: $("#clearLogButton"),
      callbackTitle: $("#callbackTitle"),
      callbackCopy: $("#callbackCopy"),
      callbackState: $("#callbackState"),
      callbackAscend: $("#callbackAscend"),
      callbackDescend: $("#callbackDescend"),
      finalScore: $("#finalScore"),
      finalBreakdown: $("#finalBreakdown"),
      finalLineScores: $("#finalLineScores"),
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
    let scoreboardOpen = false;
    let rulesOpen = false;
    let logOpen = false;
    let minimizedOverlay = null;
    let lastResourceValues = null;

    function createEnergyPhysics() {
      const reduceMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      const sims = new Map();
      const flashDecay = 2.2;
      let lastTime = 0;
      let frame = null;

      function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
      }

      function normalizeDegrees(value) {
        return ((value % 360) + 360) % 360;
      }

      function edgeHitFromDeg(nx, ny) {
        const cssImpactDeg = (Math.atan2(ny, nx) * 180) / Math.PI + 90;
        return normalizeDegrees(cssImpactDeg - 17);
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
            flash: 0,
          });
        });

        const sim = {
          size,
          center,
          boundaryRadius,
          field,
          edgeFlash: { value: 0, fromDeg: 0 },
          bodies,
        };
        sims.set(el, sim);
        paintSim(sim);
        return sim;
      }

      function paintSim(sim) {
        const edgeValue = sim.edgeFlash.value;
        sim.field.style.setProperty("--edge-hit-alpha", (edgeValue * 0.92).toFixed(3));
        sim.field.style.setProperty("--edge-hit-glow-alpha", (edgeValue * 0.34).toFixed(3));
        sim.field.style.setProperty("--edge-hit-white-alpha", (edgeValue * 0.12).toFixed(3));
        sim.field.style.setProperty("--edge-hit-from", `${sim.edgeFlash.fromDeg.toFixed(1)}deg`);
        sim.bodies.forEach((body) => {
          const flash = body.flash;
          body.el.style.transform = `translate3d(${body.x - body.r}px, ${body.y - body.r}px, 0)`;
          body.el.style.setProperty("--orb-flash", flash.toFixed(3));
          body.el.style.setProperty("--orb-flash-alpha", (flash * 0.72).toFixed(3));
          body.el.style.setProperty("--orb-white-flash-alpha", (flash * 0.28).toFixed(3));
          body.el.style.setProperty("--orb-color-flash-alpha", (flash * 0.78).toFixed(3));
          body.el.style.setProperty("--orb-flash-brightness", (1 + flash * 0.55).toFixed(3));
          body.el.style.setProperty("--orb-flash-saturate", (1 + flash * 0.3).toFixed(3));
          body.el.style.setProperty("--orb-halo-alpha", (0.68 + flash * 0.32).toFixed(3));
          body.el.style.setProperty("--orb-flash-white-size", `${(5 + flash * 8).toFixed(2)}px`);
          body.el.style.setProperty("--orb-flash-glow-size", `${(16 + flash * 18).toFixed(2)}px`);
          body.el.style.setProperty("--orb-mid-glow-mix", `${(62 + flash * 18).toFixed(1)}%`);
          body.el.style.setProperty("--orb-halo-glow-mix", `${(34 + flash * 42).toFixed(1)}%`);
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
        if (impulse >= -0.01) return;

        a.vx += impulse * nx;
        a.vy += impulse * ny;
        b.vx -= impulse * nx;
        b.vy -= impulse * ny;
        a.flash = Math.max(a.flash, 1);
        b.flash = Math.max(b.flash, 1);
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
            body.flash = Math.max(0, body.flash - dt * flashDecay);
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
              body.flash = Math.max(body.flash, 0.75);
              sim.edgeFlash.value = Math.max(sim.edgeFlash.value, 1);
              sim.edgeFlash.fromDeg = edgeHitFromDeg(nx, ny);
            }
          });
          sim.edgeFlash.value = Math.max(0, sim.edgeFlash.value - dt * flashDecay);

          for (let i = 0; i < sim.bodies.length; i += 1) {
            for (let j = i + 1; j < sim.bodies.length; j += 1) {
              collideBodies(sim.bodies[i], sim.bodies[j]);
            }
          }
          paintSim(sim);
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

    function createEmberPhysics() {
      const selector = ".icon-button, .stone-button, .action-button, .abandon-button, .lane, .guiyuan-cell";
      const reduceMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      const sims = new Map();
      const layerInset = 0;
      let lastTime = 0;
      let frame = null;

      function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
      }

      function closestTarget(target) {
        return target?.closest?.(selector) || null;
      }

      function containsTarget(el, target) {
        return typeof Node !== "undefined" && target instanceof Node && el.contains(target);
      }

      function isUsable(el) {
        return Boolean(el?.isConnected && !el.disabled);
      }

      function wantsLight(sim) {
        return Boolean(sim.hover || sim.focus || sim.press);
      }

      function ensureLayer(el) {
        let layer = el.querySelector(":scope > .ember-layer");
        if (!layer) {
          layer = documentRef.createElement("span");
          layer.className = "ember-layer";
          layer.setAttribute("aria-hidden", "true");
          for (let i = 0; i < 3; i += 1) {
            const spot = documentRef.createElement("span");
            spot.className = "ember-spot";
            layer.appendChild(spot);
          }
          el.appendChild(layer);
        }
        return layer;
      }

      function initSim(el) {
        const layer = ensureLayer(el);
        const rect = el.getBoundingClientRect();
        const width = Math.max(1, rect.width + layerInset * 2);
        const height = Math.max(1, rect.height + layerInset * 2);
        const baseSize = clamp(Math.min(width, height) * 0.62, 34, 82);
        const spots = Array.from(layer.querySelectorAll(".ember-spot")).map((spot, index) => {
          const seed = index + 1;
          const size = baseSize * (0.78 + index * 0.16);
          const speed = clamp(Math.max(width, height) * (0.045 + index * 0.012), 4, 14);
          const angle = -Math.PI / 2 + seed * 2.17;
          spot.style.setProperty("--ember-size", `${size.toFixed(1)}px`);
          spot.style.setProperty("--ember-blur", `${(size * 0.24).toFixed(1)}px`);
          spot.style.setProperty("--ember-core", index === 0 ? "var(--ember-a)" : index === 1 ? "var(--ember-b)" : "var(--ember-c)");
          spot.style.setProperty("--ember-fill", index === 0 ? "var(--ember-b)" : index === 1 ? "var(--ember-c)" : "var(--ember-a)");
          return {
            el: spot,
            x: width * (0.24 + index * 0.24),
            y: height * (0.25 + ((index * 37) % 48) / 100),
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            size,
            phase: index * 1.83,
          };
        });
        const previous = sims.get(el);
        const sim = {
          hover: previous?.hover || false,
          focus: previous?.focus || false,
          press: previous?.press || false,
          width,
          height,
          layer,
          spots,
        };
        sims.set(el, sim);
        paintSim(sim, performance.now() / 1000);
        return sim;
      }

      function paintSim(sim, timeSeconds) {
        sim.spots.forEach((spot) => {
          const flicker = 0.5 + 0.5 * Math.sin(timeSeconds * (2.1 + spot.phase * 0.18) + spot.phase);
          const shimmer = 0.5 + 0.5 * Math.sin(timeSeconds * (3.7 + spot.phase * 0.11) + spot.phase * 2.3);
          spot.el.style.setProperty("--ember-x", `${spot.x.toFixed(2)}px`);
          spot.el.style.setProperty("--ember-y", `${spot.y.toFixed(2)}px`);
          spot.el.style.setProperty("--ember-opacity", (0.3 + flicker * 0.24 + shimmer * 0.08).toFixed(3));
          spot.el.style.setProperty("--ember-scale", (0.9 + flicker * 0.18).toFixed(3));
        });
      }

      function activate(el, key) {
        if (reduceMotion || !isUsable(el)) return;
        const sim = sims.get(el) || initSim(el);
        sim[key] = true;
        el.classList.add("has-ember-light");
        requestFrame();
      }

      function deactivate(el, key) {
        const sim = sims.get(el);
        if (!sim) return;
        sim[key] = false;
        if (!wantsLight(sim)) {
          el.classList.remove("has-ember-light");
          sims.delete(el);
        }
      }

      function tick(time) {
        const dt = Math.min((time - lastTime) / 1000 || 0.016, 0.033);
        lastTime = time;
        sims.forEach((sim, el) => {
          if (!isUsable(el) || !wantsLight(sim)) {
            el.classList.remove("has-ember-light");
            sims.delete(el);
            return;
          }

          const rect = el.getBoundingClientRect();
          const width = Math.max(1, rect.width + layerInset * 2);
          const height = Math.max(1, rect.height + layerInset * 2);
          if (Math.abs(width - sim.width) > 1 || Math.abs(height - sim.height) > 1) {
            sim = initSim(el);
            el.classList.add("has-ember-light");
          }

          sim.spots.forEach((spot) => {
            spot.x += spot.vx * dt;
            spot.y += spot.vy * dt;
            if (spot.x < 0 || spot.x > sim.width) {
              spot.x = clamp(spot.x, 0, sim.width);
              spot.vx *= -1;
            }
            if (spot.y < 0 || spot.y > sim.height) {
              spot.y = clamp(spot.y, 0, sim.height);
              spot.vy *= -1;
            }
          });
          paintSim(sim, time / 1000);
        });
        frame = sims.size > 0 ? window.requestAnimationFrame(tick) : null;
      }

      function requestFrame() {
        if (frame === null) {
          lastTime = performance.now();
          frame = window.requestAnimationFrame(tick);
        }
      }

      function sync() {
        sims.forEach((sim, el) => {
          if (!isUsable(el) || !wantsLight(sim)) {
            el.classList.remove("has-ember-light");
            sims.delete(el);
          }
        });
        if (sims.size > 0) requestFrame();
      }

      documentRef.addEventListener("pointerover", (event) => {
        const el = closestTarget(event.target);
        if (!el || containsTarget(el, event.relatedTarget)) return;
        activate(el, "hover");
      });
      documentRef.addEventListener("pointerout", (event) => {
        const el = closestTarget(event.target);
        if (!el || containsTarget(el, event.relatedTarget)) return;
        deactivate(el, "hover");
      });
      documentRef.addEventListener("pointerdown", (event) => {
        const el = closestTarget(event.target);
        if (el) activate(el, "press");
      });
      documentRef.addEventListener("pointerup", () => {
        sims.forEach((_sim, el) => deactivate(el, "press"));
      });
      documentRef.addEventListener("pointercancel", () => {
        sims.forEach((_sim, el) => deactivate(el, "press"));
      });
      documentRef.addEventListener("focusin", (event) => {
        const el = closestTarget(event.target);
        if (el) activate(el, "focus");
      });
      documentRef.addEventListener("focusout", (event) => {
        const el = closestTarget(event.target);
        if (el) deactivate(el, "focus");
      });

      return { sync };
    }

    const emberPhysics = typeof window === "undefined" ? null : createEmberPhysics();

    function captureUndo() {
      undoSnapshot = snapshotUndo(state, rngController.getState());
    }

    function resetGame() {
      undoSnapshot = null;
      minimizedOverlay = null;
      scoreboardOpen = false;
      clearActiveSave();
      rngController.reseed(seedSource);
      state = createState(state.bestScore || loadBestScore(), rng);
      addLog(state, "新局已重启。", "system");
      render();
    }

    function undoLastAction() {
      if (!undoSnapshot || state.phase === "gameover") return;
      const restored = parseUndoSnapshot(undoSnapshot, state.bestScore || loadBestScore());
      if (!restored) return;
      state = snapshotState(restored.state);
      minimizedOverlay = null;
      if (restored.rngState !== null) {
        rngController.setState(restored.rngState);
      }
      undoSnapshot = null;
      addLog(state, "撤销：回到上一步。", "undo");
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

    function renderSeal(seal) {
      const el = documentRef.createElement("span");
      el.className = `seal seal-${seal.type} ${COLORS[seal.color].className}`;
      el.textContent = SEAL_TYPES[seal.type].label;
      el.setAttribute("aria-label", sealName(seal));
      return el;
    }

    function renderGuiyuanGrid() {
      nodes.guiyuanGrid.textContent = "";
      state.guiyuanGrid = normalizeGuiyuanGrid(state.guiyuanGrid);
      nodes.pendingSealText.textContent = state.pendingSeal ? `待安 ${sealName(state.pendingSeal.seal)}` : "静候结印";
      const scoring = calculateGuiyuanScore(state.guiyuanGrid);
      const completeLines = scoring.lineScores.filter((line) => line.complete);
      const completedCells = new Map();
      const addCellLine = (x, y, axis, lineIndex) => {
        const key = `${x},${y}`;
        const lines = completedCells.get(key) || {};
        lines[axis] = lineIndex;
        completedCells.set(key, lines);
      };
      completeLines.forEach((line) => {
        const lineIndex = guiyuanLineIndex(line.id);
        if (line.id.startsWith("row-")) {
          const y = Number(line.id.split("-")[1]);
          for (let x = 0; x < GUIYUAN_SIZE; x += 1) addCellLine(x, y, "row", lineIndex);
        }
        if (line.id.startsWith("col-")) {
          const x = Number(line.id.split("-")[1]);
          for (let y = 0; y < GUIYUAN_SIZE; y += 1) addCellLine(x, y, "col", lineIndex);
        }
      });

      for (let y = 0; y < GUIYUAN_SIZE; y += 1) {
        for (let x = 0; x < GUIYUAN_SIZE; x += 1) {
          const seal = state.guiyuanGrid[y][x];
          const legal = state.phase === "placeSeal" && isLegalSealPosition(state, x, y);
          const cell = documentRef.createElement("button");
          cell.type = "button";
          const scoreLines = completedCells.get(`${x},${y}`) || {};
          const hasRowScore = Number.isFinite(scoreLines.row);
          const hasColScore = Number.isFinite(scoreLines.col);
          cell.className = `guiyuan-cell${seal ? " has-seal" : ""}${legal ? " is-legal" : ""}${hasRowScore || hasColScore ? " is-scored" : ""}${hasRowScore ? " has-score-row" : ""}${hasColScore ? " has-score-col" : ""}`;
          if (hasRowScore) {
            cell.style.setProperty("--score-row-ring", guiyuanLineColor(scoreLines.row));
          }
          if (hasColScore) {
            cell.style.setProperty("--score-col-ring", guiyuanLineColor(scoreLines.col));
          }
          cell.dataset.x = String(x);
          cell.dataset.y = String(y);
          cell.disabled = state.phase !== "placeSeal" || !legal;
          cell.setAttribute("aria-label", seal ? `${formatCoord(x, y)} ${sealName(seal)}` : `${formatCoord(x, y)} 空位`);
          if (seal) {
            cell.appendChild(renderSeal(seal));
          } else {
            const empty = documentRef.createElement("span");
            empty.className = "guiyuan-empty";
            empty.textContent = legal ? "可安" : "";
            cell.appendChild(empty);
          }
          nodes.guiyuanGrid.appendChild(cell);
        }
      }

      if (completeLines.length > 0) {
        const scoreList = documentRef.createElement("div");
        scoreList.className = "guiyuan-line-scores";
        completeLines.forEach((line) => {
          const mark = documentRef.createElement("span");
          mark.className = "guiyuan-line-score";
          mark.style.setProperty("--line-score-color", guiyuanLineColor(guiyuanLineIndex(line.id)));
          const typeLabel = typeScoreLabel(line.typeScore);
          const colorLabelText = colorScoreLabel(line.colorScore);
          mark.textContent = `${line.label} ${typeLabel} · ${colorLabelText} = ${line.total}`;
          mark.setAttribute("aria-label", `${line.label}，${typeLabel}，${colorLabelText}，共${line.total}分`);
          scoreList.appendChild(mark);
        });
        nodes.guiyuanGrid.appendChild(scoreList);
      }
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
      const ascendValue = state.ascend.slots[0]?.value || 1;
      const descendValue = state.descend.slots[0]?.value || 5;
      const ascendAfter = Math.max(1, ascendValue - pending.strength);
      const descendAfter = Math.min(5, descendValue + pending.strength);
      nodes.callbackTitle.textContent = `回调 ${pending.strength} 档`;
      nodes.callbackCopy.textContent = `${patternRuleLabel(pending.pattern)}倍率已计入。新锚色为${colorLabel(pending.color)}。回调后仍保留该脉已填入的后续息珠。`;
      nodes.callbackState.innerHTML = `
        <span class="callback-value">
          <span>升脉</span>
          <strong>${ascendValue}</strong>
          <em>→ ${ascendAfter}</em>
        </span>
        <span class="callback-value">
          <span>降脉</span>
          <strong>${descendValue}</strong>
          <em>→ ${descendAfter}</em>
        </span>
      `;
      nodes.callbackAscend.textContent = `回调升脉 ${ascendValue}→${ascendAfter}`;
      nodes.callbackDescend.textContent = `回调降脉 ${descendValue}→${descendAfter}`;
    }

    function overlayLabel(overlayName) {
      return {
        setup: "开局",
        callback: "回调",
        scoreboard: "计分榜",
        rules: "规则",
        log: "日志",
        gameover: "本局归元",
      }[overlayName] || "弹窗";
    }

    function activeOverlayNames() {
      const names = [];
      if (state.phase === "setup") names.push("setup");
      if (state.phase === "callback") names.push("callback");
      if (scoreboardOpen) names.push("scoreboard");
      if (rulesOpen) names.push("rules");
      if (logOpen) names.push("log");
      if (state.phase === "gameover") names.push("gameover");
      return names;
    }

    function syncMinimizedOverlay() {
      if (minimizedOverlay && !activeOverlayNames().includes(minimizedOverlay)) {
        minimizedOverlay = null;
      }
    }

    function applyOverlayMinimized(node, overlayName) {
      const minimized = minimizedOverlay === overlayName;
      node.classList.toggle("is-minimized", minimized);
      node.querySelector(".modal")?.classList.toggle("is-minimized", minimized);
    }

    function renderGameOver() {
      const visible = state.phase === "gameover";
      nodes.gameOverOverlay.classList.toggle("is-visible", visible);
      nodes.finalScore.textContent = state.finalScore || state.clarity;
      nodes.finalBreakdown.textContent = `清明 ${state.clarity} + 归元图 ${state.guiyuanScore || 0}`;
      nodes.finalLineScores.textContent = "";
      (state.lineScores || []).forEach((line) => {
        const item = documentRef.createElement("p");
        item.textContent = formatLineScore(line);
        nodes.finalLineScores.appendChild(item);
      });
      nodes.bestScoreText.textContent = `最高纪录：${state.bestScore || 0}`;
    }

    function renderRules() {
      nodes.rulesOverlay.classList.toggle("is-visible", rulesOpen);
    }

    function formatRecordTime(value) {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "-";
      return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
    }

    function formatDuration(value) {
      const totalSeconds = Math.max(0, Math.round(Number(value || 0) / 1000));
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
      return `${minutes}:${String(seconds).padStart(2, "0")}`;
    }

    function average(records, getter) {
      if (records.length === 0) return 0;
      return records.reduce((sum, record) => sum + Number(getter(record) || 0), 0) / records.length;
    }

    function maxOf(records, getter) {
      return records.length === 0 ? 0 : Math.max(...records.map((record) => Number(getter(record) || 0)));
    }

    function formatAverage(value) {
      return Number(value || 0).toFixed(1).replace(/\.0$/, "");
    }

    function statTile(label, value) {
      const item = documentRef.createElement("span");
      item.className = "score-stat";
      const name = documentRef.createElement("span");
      name.textContent = label;
      const number = documentRef.createElement("strong");
      number.textContent = value;
      item.append(name, number);
      return item;
    }

    function statGroup(title, tiles) {
      const group = documentRef.createElement("section");
      group.className = "score-stat-group";
      const heading = documentRef.createElement("h3");
      heading.className = "score-stat-title";
      heading.textContent = title;
      const stats = documentRef.createElement("div");
      stats.className = "score-stats";
      stats.append(...tiles);
      group.append(heading, stats);
      return group;
    }

    function scoreMetricDefinitions() {
      return [
        { label: "总分", get: (record) => record.finalScore },
        { label: "清明", get: (record) => record.clarity },
        { label: "归元图", get: (record) => record.guiyuanScore },
        { label: "息周", get: (record) => record.turnCount },
        { label: "用时", get: (record) => record.durationMs, format: formatDuration, averageFormat: formatDuration },
        { label: "抽息", get: (record) => record.runStats.drawCount },
        { label: "新周抽", get: (record) => record.runStats.turnDrawCount },
        { label: "换气重抽", get: (record) => record.runStats.breathRedrawCount },
        { label: "断息重抽", get: (record) => record.runStats.wasteRedrawCount },
        { label: "落子", get: (record) => record.runStats.placementCount },
        { label: "升落子", get: (record) => record.runStats.ascendPlacements },
        { label: "中落子", get: (record) => record.runStats.centerPlacements },
        { label: "降落子", get: (record) => record.runStats.descendPlacements },
        { label: "赤落子", get: (record) => record.runStats.redPlacements },
        { label: "青落子", get: (record) => record.runStats.bluePlacements },
        { label: "黄落子", get: (record) => record.runStats.yellowPlacements },
        { label: "1点落子", get: (record) => record.runStats.value1Placements },
        { label: "2点落子", get: (record) => record.runStats.value2Placements },
        { label: "3点落子", get: (record) => record.runStats.value3Placements },
        { label: "4点落子", get: (record) => record.runStats.value4Placements },
        { label: "5点落子", get: (record) => record.runStats.value5Placements },
        { label: "换气", get: (record) => record.runStats.breathCount },
        { label: "断息", get: (record) => record.runStats.wasteCount },
        { label: "皆为余念", get: (record) => record.runStats.wasteByRemnant },
        { label: "无处安放", get: (record) => record.runStats.wasteByNoPlace },
        { label: "心息损失", get: (record) => record.runStats.heartLost },
        { label: "换气损失", get: (record) => record.runStats.heartLostByBreath },
        { label: "断息损失", get: (record) => record.runStats.heartLostByWaste },
        { label: "回复次数", get: (record) => record.runStats.heartHealEvents },
        { label: "心息回复", get: (record) => record.runStats.heartHealed },
        { label: "清明获得", get: (record) => record.runStats.clarityGained },
        { label: "升结算", get: (record) => record.runStats.ascendSettles },
        { label: "降结算", get: (record) => record.runStats.descendSettles },
        { label: "中宫三条", get: (record) => record.runStats.centerTriplets },
        { label: "中宫顺子", get: (record) => record.runStats.centerStraights },
        { label: "调和", get: (record) => record.runStats.harmonyCount },
        { label: "凝聚", get: (record) => record.runStats.cohesionCount },
        { label: "普通", get: (record) => record.runStats.ordinaryCount },
        { label: "回调", get: (record) => record.runStats.callbackCount },
        { label: "回调升", get: (record) => record.runStats.callbackAscendCount },
        { label: "回调降", get: (record) => record.runStats.callbackDescendCount },
        { label: "回调档数", get: (record) => record.runStats.callbackSteps },
        { label: "余念生成", get: (record) => record.runStats.remnantGenerated },
        { label: "余念清空", get: (record) => record.runStats.remnantCleared },
        { label: "无念获得", get: (record) => record.runStats.noMindGained },
        { label: "无念发动", get: (record) => record.runStats.noMindUsed },
        { label: "升最高锚", get: (record) => record.runStats.maxAscendAnchor },
        { label: "降最低锚", get: (record) => record.runStats.minDescendAnchor },
        { label: "升脉闭", get: (record) => record.runStats.ascendClosedCount },
        { label: "降脉闭", get: (record) => record.runStats.descendClosedCount },
      ];
    }

    function metricTiles(records, mode) {
      return scoreMetricDefinitions().map((definition) => {
        const value = mode === "average" ? average(records, definition.get) : maxOf(records, definition.get);
        const formatter =
          mode === "average" ? definition.averageFormat || formatAverage : definition.format || ((item) => Math.round(item));
        return statTile(definition.label, formatter(value));
      });
    }

    function recordLine(label, value) {
      const line = documentRef.createElement("p");
      line.className = "score-record-detail";
      line.textContent = `${label}：${value}`;
      return line;
    }

    function renderScoreboard() {
      nodes.scoreboardOverlay.classList.toggle("is-visible", scoreboardOpen);
      if (!scoreboardOpen) return;
      const records = loadScoreboardRecords().sort((a, b) => b.endedAt - a.endedAt);
      nodes.scoreboardContent.textContent = "";
      if (records.length === 0) {
        const empty = documentRef.createElement("p");
        empty.className = "log-empty";
        empty.textContent = "暂无已结束对局。";
        nodes.scoreboardContent.appendChild(empty);
        return;
      }

      nodes.scoreboardContent.appendChild(
        statGroup("关键摘要", [
          statTile("局数", records.length),
          statTile("最高总分", maxOf(records, (record) => record.finalScore)),
          statTile("最高清明", maxOf(records, (record) => record.clarity)),
          statTile("最长息周", maxOf(records, (record) => record.turnCount)),
        ])
      );
      nodes.scoreboardContent.appendChild(statGroup("全局平均", metricTiles(records, "average")));
      nodes.scoreboardContent.appendChild(statGroup("单局最大", metricTiles(records, "max")));

      const list = documentRef.createElement("div");
      list.className = "score-records";
      records.forEach((record, index) => {
        const stats = record.runStats;
        const item = documentRef.createElement("article");
        item.className = "score-record";
        const title = documentRef.createElement("div");
        title.className = "score-record-head";
        title.innerHTML = `<strong>#${records.length - index} 总分 ${record.finalScore}</strong><span>${formatRecordTime(record.endedAt)}</span>`;
        const meta = documentRef.createElement("p");
        meta.className = "score-record-meta";
        meta.textContent = `清明 ${record.clarity} + 归元图 ${record.guiyuanScore} / 开始 ${formatRecordTime(record.startedAt)} / 息周 ${record.turnCount} / 用时 ${formatDuration(record.durationMs)} / ${record.endingReason}${record.isNewBest ? " / 新纪录" : ""} / 前纪录 ${record.previousBest}`;
        const finalState = documentRef.createElement("p");
        finalState.className = "score-record-state";
        finalState.textContent = `终局：余念 ${record.remnant ?? "无"} / 无念 ${record.noMind ? "有" : "无"} / 升锚 ${record.finalAnchors?.ascend ?? "-"} / 降锚 ${record.finalAnchors?.descend ?? "-"}`;
        const laneState = documentRef.createElement("p");
        laneState.className = "score-record-state";
        laneState.textContent = `三脉：升 ${record.lanes.ascend || "-"} | 中 ${record.lanes.center || "-"} | 降 ${record.lanes.descend || "-"}`;
        const gridState = documentRef.createElement("p");
        gridState.className = "score-record-state";
        gridState.textContent = `归元图：${record.guiyuanGrid.map((row) => row.map(sealShortName).join("/")).join(" | ")}`;
        const lineState = documentRef.createElement("p");
        lineState.className = "score-record-state";
        lineState.textContent = `线分：${(record.lineScores || []).map(formatLineScore).join("；") || "-"}`;
        item.append(
          title,
          meta,
          recordLine("抽息", `总${stats.drawCount} / 新周${stats.turnDrawCount} / 换气${stats.breathRedrawCount} / 断息后${stats.wasteRedrawCount}`),
          recordLine("损耗回复", `换气${stats.breathCount} / 断息${stats.wasteCount} / 皆为余念${stats.wasteByRemnant} / 无处安放${stats.wasteByNoPlace} / 心息损失${stats.heartLost} / 回复${stats.heartHealed}`),
          recordLine("落子", `总${stats.placementCount} / 升${stats.ascendPlacements} 中${stats.centerPlacements} 降${stats.descendPlacements} / 赤${stats.redPlacements} 青${stats.bluePlacements} 黄${stats.yellowPlacements} / 点数1:${stats.value1Placements} 2:${stats.value2Placements} 3:${stats.value3Placements} 4:${stats.value4Placements} 5:${stats.value5Placements}`),
          recordLine("结算", `升${stats.ascendSettles} 降${stats.descendSettles} / 三条${stats.centerTriplets} 顺子${stats.centerStraights} / 普通${stats.ordinaryCount} 凝聚${stats.cohesionCount} 调和${stats.harmonyCount} / 清明+${stats.clarityGained}`),
          recordLine("余念无念", `余念生成${stats.remnantGenerated} / 清空${stats.remnantCleared} / 无念获得${stats.noMindGained} / 发动${stats.noMindUsed}`),
          recordLine("回调脉象", `回调${stats.callbackCount} / 升${stats.callbackAscendCount} 降${stats.callbackDescendCount} / 总档${stats.callbackSteps} / 升最高锚${stats.maxAscendAnchor || "-"} / 降最低锚${stats.minDescendAnchor || "-"} / 升闭${stats.ascendClosedCount} 降闭${stats.descendClosedCount}`),
          finalState,
          laneState,
          gridState,
          lineState
        );
        list.appendChild(item);
      });
      nodes.scoreboardContent.appendChild(list);
    }

    function renderLog() {
      nodes.logOverlay.classList.toggle("is-visible", logOpen);
      nodes.logList.textContent = "";
      const entries = normalizeDebugLog(state.debugLog);
      if (entries.length === 0) {
        const empty = documentRef.createElement("p");
        empty.className = "log-empty";
        empty.textContent = "本局暂无详细日志。";
        nodes.logList.appendChild(empty);
        return;
      }

      entries.forEach((entry) => {
        const item = documentRef.createElement("article");
        item.className = "log-entry";

        const head = documentRef.createElement("div");
        head.className = "log-entry-head";
        const type = documentRef.createElement("span");
        type.className = "log-entry-type";
        type.textContent = entry.type || "log";
        const meta = documentRef.createElement("span");
        meta.textContent = `#${entry.seq || entry.id || ""} / 周${entry.turn ?? 0} / ${entry.phase || "-"}`;
        head.append(type, meta);

        const text = documentRef.createElement("p");
        text.className = "log-entry-text";
        text.textContent = entry.text;

        const snapshot = documentRef.createElement("p");
        snapshot.className = "log-entry-state";
        snapshot.textContent = entry.snapshot ? formatDebugSnapshot(entry.snapshot) : "";

        item.append(head, text, snapshot);
        nodes.logList.appendChild(item);
      });
    }

    function phaseText() {
      return {
        setup: "开局",
        placeSeal: "安印",
        chooseStone: "择息",
        chooseLane: "落脉",
        callback: "回调",
        waste: "断息",
        gameover: "结束",
      }[state.phase];
    }

    function currentResourceValues() {
      return {
        heart: state.heart,
        clarity: state.clarity,
        turnCount: state.turnCount || 0,
        remnant: state.remnant === null ? "无" : state.remnant,
        noMind: state.noMind ? "有" : "无",
      };
    }

    function resourceTone(key, previous, next) {
      if (key === "remnant" || key === "noMind") return "neutral";
      if (typeof previous === "number" && typeof next === "number") {
        return next > previous ? "up" : "down";
      }
      return "neutral";
    }

    function resourceFloatText(key, previous, next) {
      if (key === "remnant" || key === "noMind") return `→ ${next}`;
      if (typeof previous === "number" && typeof next === "number") {
        const diff = next - previous;
        return diff > 0 ? `+${diff}` : String(diff);
      }
      return `→ ${next}`;
    }

    function showResourceFloat(node, text, direction) {
      const card = node?.closest?.(".resource");
      if (!card || !text) return;
      const float = documentRef.createElement("span");
      float.className = `resource-float is-${direction}`;
      float.textContent = text;
      float.setAttribute("aria-hidden", "true");
      float.addEventListener("animationend", () => float.remove(), { once: true });
      card.appendChild(float);
      window.setTimeout(() => float.remove(), 1900);
    }

    function renderResourceValues() {
      const values = currentResourceValues();
      if (lastResourceValues) {
        [
          ["heart", nodes.heart],
          ["clarity", nodes.clarity],
          ["turnCount", nodes.turnCount],
          ["remnant", nodes.remnant],
          ["noMind", nodes.noMind],
        ].forEach(([key, node]) => {
          const previous = lastResourceValues[key];
          const next = values[key];
          if (previous === next) return;
          showResourceFloat(node, resourceFloatText(key, previous, next), resourceTone(key, previous, next));
        });
      }

      nodes.heart.textContent = `${values.heart}/${MAX_HEART}`;
      nodes.clarity.textContent = values.clarity;
      nodes.turnCount.textContent = values.turnCount;
      nodes.remnant.textContent = values.remnant;
      nodes.noMind.textContent = values.noMind;
      lastResourceValues = values;
    }

    function render() {
      syncMinimizedOverlay();
      renderResourceValues();
      nodes.phaseText.textContent = phaseText();
      nodes.primaryMessage.textContent = state.message;
      nodes.undoButton.disabled = !undoSnapshot || state.phase === "gameover";
      nodes.abandonButton.textContent = state.phase === "waste" ? "继续" : "换气";
      nodes.abandonButton.disabled = !(
        (state.phase === "chooseStone" && state.drawPair.length > 0 && state.heart > 0) ||
        (state.phase === "waste" && state.heart > 0)
      );
      nodes.historyList.textContent = "";
      state.history.slice(1, 5).forEach((entry) => {
        const li = documentRef.createElement("li");
        li.textContent = entry;
        nodes.historyList.appendChild(li);
      });
      renderLanes();
      renderGuiyuanGrid();
      renderDrawPair();
      renderSetup();
      renderCallback();
      renderGameOver();
      renderScoreboard();
      renderRules();
      renderLog();
      applyOverlayMinimized(nodes.setupOverlay, "setup");
      applyOverlayMinimized(nodes.callbackOverlay, "callback");
      applyOverlayMinimized(nodes.scoreboardOverlay, "scoreboard");
      applyOverlayMinimized(nodes.rulesOverlay, "rules");
      applyOverlayMinimized(nodes.logOverlay, "log");
      applyOverlayMinimized(nodes.gameOverOverlay, "gameover");
      documentRef.body?.classList.toggle("has-minimized-overlay", Boolean(minimizedOverlay));
      nodes.minimizedDock.hidden = !minimizedOverlay;
      nodes.minimizedDockLabel.textContent = minimizedOverlay ? `${overlayLabel(minimizedOverlay)}已最小化` : "";
      energyPhysics?.sync();
      emberPhysics?.sync();
      persist(state, undoSnapshot, rngController.getState());
    }

    Object.entries(nodes.lanes).forEach(([laneName, lane]) => {
      lane.addEventListener("click", () => {
        captureUndo();
        placeSelected(state, laneName, rng);
        render();
      });
    });

    nodes.guiyuanGrid.addEventListener("click", (event) => {
      const cell = event.target.closest(".guiyuan-cell");
      if (!cell || cell.disabled) return;
      captureUndo();
      placePendingSeal(state, Number(cell.dataset.x), Number(cell.dataset.y), rng);
      render();
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
    $("#scoreboardButton").addEventListener("click", () => {
      scoreboardOpen = true;
      rulesOpen = false;
      logOpen = false;
      minimizedOverlay = null;
      render();
    });
    $("#closeScoreboardButton").addEventListener("click", () => {
      scoreboardOpen = false;
      minimizedOverlay = null;
      render();
    });
    $("#closeScoreboardActionButton").addEventListener("click", () => {
      scoreboardOpen = false;
      minimizedOverlay = null;
      render();
    });
    $("#rulesButton").addEventListener("click", () => {
      rulesOpen = true;
      scoreboardOpen = false;
      logOpen = false;
      minimizedOverlay = null;
      render();
    });
    $("#closeRulesButton").addEventListener("click", () => {
      rulesOpen = false;
      minimizedOverlay = null;
      render();
    });
    $("#closeRulesActionButton").addEventListener("click", () => {
      rulesOpen = false;
      minimizedOverlay = null;
      render();
    });
    $("#logButton").addEventListener("click", () => {
      logOpen = true;
      scoreboardOpen = false;
      rulesOpen = false;
      minimizedOverlay = null;
      render();
    });
    $("#closeLogButton").addEventListener("click", () => {
      logOpen = false;
      minimizedOverlay = null;
      render();
    });
    $("#closeLogActionButton").addEventListener("click", () => {
      logOpen = false;
      minimizedOverlay = null;
      render();
    });
    $("#clearLogButton").addEventListener("click", () => {
      state.debugLog = [];
      if (undoSnapshot?.state) {
        undoSnapshot.state.debugLog = [];
      } else if (undoSnapshot?.debugLog) {
        undoSnapshot.debugLog = [];
      }
      render();
    });
    $("#undoButton").addEventListener("click", undoLastAction);
    $("#abandonButton").addEventListener("click", () => {
      if (state.phase === "waste") {
        continueAfterWaste(state, rng);
      } else {
        captureUndo();
        abandonDraw(state, rng);
      }
      render();
    });
    $("#restartButton").addEventListener("click", resetGame);
    $("#newGameButton").addEventListener("click", resetGame);
    documentRef.querySelectorAll("[data-minimize]").forEach((button) => {
      button.addEventListener("click", () => {
        minimizedOverlay = button.dataset.minimize;
        render();
      });
    });
    $("#restoreOverlayButton").addEventListener("click", () => {
      minimizedOverlay = null;
      render();
    });

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
    continueAfterWaste,
    selectStone,
    placeSelected,
    applyCallback,
    placePendingSeal,
    isLegalSealPosition,
    calculateGuiyuanScore,
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
