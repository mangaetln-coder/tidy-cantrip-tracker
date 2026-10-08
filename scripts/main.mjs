const MODULE_ID = "tidy-cantrip-tracker";
const ASSIGNMENT_FLAG = "assignment";
const AUTO = "auto";
const OTHER = "bonus";      // Kept for backward compatibility with v0.1.0 flags.
const UNASSIGNED = "unknown"; // Kept for backward compatibility with v0.1.0 flags.
const SHEET_OBSERVERS = new WeakMap();

Hooks.once("ready", () => {
  const systemVersion = game.system?.version ?? "0";
  const major = Number.parseInt(String(systemVersion).split(".")[0] ?? "0", 10);
  if (major !== 6 && game.user?.isGM) {
    ui.notifications.warn(i18n("TCT.Notification.UnsupportedSystem"));
  }
});

Hooks.on("renderActorSheetV2", (app, element) => {
  try {
    if (!(element instanceof HTMLElement)) return;
    if (!element.classList.contains("tidy5e-sheet")) return;

    const actor = app.actor ?? app.document ?? app.object;
    if (!actor || actor.type !== "character") return;

    ensureTrackerObserver(element, actor);
    refreshTracker(element, actor);
  } catch (error) {
    console.error(`${MODULE_ID} | Unable to render cantrip tracker`, error);
  }
});

function ensureTrackerObserver(element, actor) {
  const existing = SHEET_OBSERVERS.get(element);
  if (existing) {
    existing.actor = actor;
    return;
  }

  const state = {
    element,
    actor,
    observer: null,
    scheduled: false
  };

  state.observer = new MutationObserver((mutations) => {
    if (!mutations.some(isRelevantSpellcastingMutation)) return;
    if (state.scheduled) return;

    state.scheduled = true;
    const schedule = globalThis.requestAnimationFrame
      ?? ((callback) => globalThis.setTimeout(callback, 0));

    schedule(() => {
      state.scheduled = false;
      if (!state.element.isConnected) return;
      refreshTracker(state.element, state.actor);
    });
  });

  SHEET_OBSERVERS.set(element, state);
  observeTrackerState(state);
}

function observeTrackerState(state) {
  state.observer.observe(state.element, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["class"]
  });
}

function refreshTracker(element, actor) {
  const state = SHEET_OBSERVERS.get(element);
  if (state) {
    state.actor = actor;
    state.observer.disconnect();
  }

  try {
    renderTracker(element, actor);
  } finally {
    if (state && element.isConnected) observeTrackerState(state);
  }
}

function isRelevantSpellcastingMutation(mutation) {
  if (mutation.type === "attributes") {
    const target = mutation.target;
    return target instanceof Element
      && (
        target.matches(".spellcasting-cards")
        || target.matches(".spellcasting-class-card:not(.tct-other-card)")
      );
  }

  if (mutation.type !== "childList") return false;

  const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
  return nodes.some((node) => {
    if (!(node instanceof Element)) return false;

    const selector = ".spellcasting-cards, .spellcasting-class-card:not(.tct-other-card), .tct-cantrip-pill, .tct-other-card";
    return node.matches(selector) || Boolean(node.querySelector?.(selector));
  });
}

function renderTracker(element, actor) {
  element.querySelectorAll(".tct-cantrip-pill, .tct-other-card").forEach((node) => node.remove());

  const report = buildReport(actor);
  if (!report.shouldDisplay) return;

  const cardsContainer = element.querySelector(".sheet-footer.spellbook-footer .spellcasting-cards")
    ?? element.querySelector(".spellcasting-cards");
  if (!cardsContainer) {
    console.warn(`${MODULE_ID} | Could not find the Tidy spellcasting footer for ${actor.name}`);
    return;
  }

  let inserted = false;

  for (const classInfo of report.classes) {
    if (classInfo.max == null && classInfo.count === 0) continue;

    const classCard = findClassCard(cardsContainer, classInfo.item);
    if (!classCard) continue;

    const info = classCard.querySelector(".info.pills");
    if (!info) continue;

    const preparedControl = Array.from(classCard.querySelectorAll("[data-emphasize-uuid]"))
      .find((node) => node.dataset?.emphasizeUuid === classInfo.item.uuid)
      ?? classCard.querySelector(".prepared");

    const pill = createClassCantripPill(actor, classInfo);
    if (preparedControl?.parentElement === info) info.insertBefore(pill, preparedControl);
    else info.append(pill);

    inserted = true;
  }

  if (report.other.length || report.unassigned.length) {
    const referenceCard = cardsContainer.querySelector(".spellcasting-class-card");
    const otherCard = createOtherCard(actor, report, referenceCard);
    if (referenceCard) cardsContainer.insertBefore(otherCard, referenceCard);
    else cardsContainer.append(otherCard);
    inserted = true;
  }

  if (!inserted) {
    console.warn(`${MODULE_ID} | No compatible Tidy spellcasting class card was found for ${actor.name}`);
  }
}

function findClassCard(cardsContainer, classItem) {
  for (const node of cardsContainer.querySelectorAll(".spellcasting-class-card")) {
    const matchesUuid = Array.from(node.querySelectorAll("[data-emphasize-uuid]"))
      .some((control) => control.dataset?.emphasizeUuid === classItem.uuid);
    if (matchesUuid) return node;
  }

  return Array.from(cardsContainer.querySelectorAll(".spellcasting-class-card"))
    .find((node) => node.querySelector(".header .name")?.textContent?.trim() === classItem.name)
    ?? null;
}

function createClassCantripPill(actor, classInfo) {
  const maxText = classInfo.max ?? "?";
  const over = classInfo.max != null && classInfo.count > classInfo.max;
  const ariaLabel = classInfo.max == null
    ? format("TCT.Accessibility.ClassQuotaUnknown", { class: classInfo.name, count: classInfo.count })
    : over
      ? format("TCT.Accessibility.OverQuota", { class: classInfo.name, count: classInfo.count, max: classInfo.max })
      : format("TCT.Accessibility.ClassQuota", { class: classInfo.name, count: classInfo.count, max: classInfo.max });

  const button = document.createElement("button");
  button.type = "button";
  button.className = "tct-cantrip-pill pill pill-medium interactive hide-collapsed";
  if (over) button.classList.add("is-over");
  button.title = ariaLabel;
  button.setAttribute("aria-label", ariaLabel);

  const label = document.createElement("span");
  label.className = "label font-label-medium color-text-lighter";
  label.textContent = i18n("TCT.Summary.Header");

  const value = document.createElement("span");
  value.className = "value tct-cantrip-value";
  value.innerHTML = `<span class="count font-data-medium">${classInfo.count}</span><span class="separator font-default-medium color-text-gold">/</span><span class="max font-label-medium color-text-lighter">${maxText}</span>`;

  if (over) {
    const icon = document.createElement("span");
    icon.className = "tct-warning-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "⚠";
    button.append(icon);
  }

  button.append(label, value);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openDetails(actor);
  });

  return button;
}

function createOtherCard(actor, report, referenceCard) {
  const card = document.createElement("div");
  card.className = "spellcasting-class-card flexrow tct-other-card";
  if (referenceCard?.classList.contains("compact")) card.classList.add("compact");
  if (referenceCard?.classList.contains("multiclass") || report.classes.length > 1) card.classList.add("multiclass");

  const header = document.createElement("div");
  header.className = "header flexshrink";

  const name = document.createElement("span");
  name.className = "name font-title-small";
  name.textContent = i18n("TCT.Assignment.Other");
  header.append(name);

  const info = document.createElement("div");
  info.className = "info pills flex1";

  if (report.other.length) {
    info.append(createOtherCountPill(actor, {
      label: i18n("TCT.Summary.Header"),
      count: report.other.length,
      ariaLabel: format("TCT.Accessibility.Other", { count: report.other.length })
    }));
  }

  if (report.unassigned.length) {
    info.append(createOtherCountPill(actor, {
      label: i18n("TCT.Summary.UnassignedCantrips"),
      count: report.unassigned.length,
      ariaLabel: format("TCT.Accessibility.ToAssign", { count: report.unassigned.length }),
      warning: true
    }));
  }

  card.append(header, info);
  return card;
}

function createOtherCountPill(actor, { label, count, ariaLabel, warning = false }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "tct-cantrip-pill pill pill-medium interactive";
  if (warning) button.classList.add("is-warning");
  button.title = ariaLabel;
  button.setAttribute("aria-label", ariaLabel);

  const labelNode = document.createElement("span");
  labelNode.className = "label font-label-medium color-text-lighter";
  labelNode.textContent = label;

  const value = document.createElement("span");
  value.className = "value";
  value.textContent = String(count);

  if (warning) {
    const icon = document.createElement("span");
    icon.className = "tct-warning-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "⚠";
    button.append(icon);
  }

  button.append(labelNode, value);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openDetails(actor);
  });

  return button;
}

function buildReport(actor) {
  const classItems = Array.from(actor.items ?? []).filter((item) => item.type === "class");
  const classes = classItems
    .map((item) => ({
      item,
      id: classIdentifier(item),
      name: item.name,
      level: Number(item.system?.levels ?? 0),
      max: getClassCantripMax(actor, item),
      spells: [],
      count: 0,
      over: false
    }))
    .filter((entry) => entry.id);

  const classById = new Map(classes.map((entry) => [entry.id, entry]));
  const cantrips = Array.from(actor.items ?? []).filter(isCantrip);
  const advancementProvenance = buildAdvancementProvenance(actor);
  const other = [];
  const unassigned = [];
  const rows = [];

  for (const spell of cantrips) {
    const provenance = resolveProvenance(actor, spell, advancementProvenance);
    const assignment = resolveAssignment(spell, classes, provenance);
    const row = { spell, provenance, ...assignment };
    rows.push(row);

    if (assignment.kind === "class" && classById.has(assignment.classId)) {
      const cls = classById.get(assignment.classId);
      cls.spells.push(spell);
      cls.count += 1;
    } else if (assignment.kind === "other") {
      other.push(row);
    } else {
      unassigned.push(row);
    }
  }

  for (const cls of classes) {
    cls.over = cls.max != null && cls.count > cls.max;
  }

  const shouldDisplay = cantrips.length > 0 || classes.some((entry) => entry.max != null && entry.max > 0);
  return { actor, classes, cantrips, other, unassigned, rows, shouldDisplay };
}

function isCantrip(item) {
  if (item?.type !== "spell") return false;
  const level = Number(item.system?.level ?? NaN);
  return Number.isFinite(level) && level === 0;
}

function classIdentifier(item) {
  return item?.system?.identifier ?? item?.identifier ?? null;
}

function getClassCantripMax(actor, classItem) {
  const identifier = classIdentifier(classItem);
  if (!identifier) return null;

  const scales = actor.system?.scale?.[identifier];
  const preferred = scales?.["cantrips-known"] ?? scales?.cantripsKnown ?? null;
  const preferredValue = scaleNumber(preferred);

  // D&D5e 6.0.0/6.0.1 content could leave old transferred effects on existing
  // characters which concatenate a numeric Scale Value as text (for example
  // 2 + 1 becoming "21"). Rebuild only when the prepared value is string-based
  // and we can independently determine both the class base value and additive
  // cantrip Scale Value effects.
  const rawPreferred = rawScaleValue(preferred);
  const baseValue = getClassCantripBaseValue(classItem);
  const additions = getCantripScaleAdditions(actor, identifier);
  const rebuiltValue = baseValue != null ? baseValue + additions.total : null;
  const looksConcatenated = typeof rawPreferred === "string"
    && additions.count > 0
    && rebuiltValue != null
    && preferredValue !== rebuiltValue;

  if (looksConcatenated) {
    console.warn(
      `${MODULE_ID} | Rebuilt corrupted cantrip Scale Value for ${classItem.name}: ${preferredValue} -> ${rebuiltValue}`
    );
    return rebuiltValue;
  }

  if (preferredValue != null) return preferredValue;
  if (rebuiltValue != null) return rebuiltValue;

  if (!scales || typeof scales !== "object") return null;
  for (const [key, value] of Object.entries(scales)) {
    const normalized = String(key).toLowerCase();
    if (!normalized.includes("cantrip")) continue;
    if (!normalized.includes("known") && !normalized.includes("know")) continue;
    const number = scaleNumber(value);
    if (number != null) return number;
  }

  return null;
}

function rawScaleValue(value) {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "object" && "value" in value) return rawScaleValue(value.value);
  return null;
}

function getClassCantripBaseValue(classItem) {
  const level = Number(classItem.system?.levels ?? 0);
  const advancements = classItem.system?.advancement;
  if (!advancements || !Number.isFinite(level)) return null;

  for (const advancement of advancements) {
    const identifier = advancement?.identifier ?? advancement?.configuration?.identifier ?? null;
    if (identifier !== "cantrips-known" && identifier !== "cantripsKnown") continue;

    const type = String(advancement?.type ?? advancement?.constructor?.name ?? "");
    if (type && !type.includes("ScaleValue")) continue;

    if (typeof advancement?.valueForLevel === "function") {
      const value = scaleNumber(advancement.valueForLevel(level));
      if (value != null) return value;
    }

    const scale = advancement?.configuration?.scale;
    if (!scale || typeof scale !== "object") continue;

    const levels = Object.keys(scale)
      .map((key) => Number(key))
      .filter((key) => Number.isFinite(key) && key <= level)
      .sort((a, b) => b - a);

    for (const scaleLevel of levels) {
      const value = scaleNumber(scale[String(scaleLevel)] ?? scale[scaleLevel]);
      if (value != null) return value;
    }
  }

  return null;
}

function getCantripScaleAdditions(actor, classIdentifier) {
  const currentKey = `system.scale.${classIdentifier}.cantrips-known.value`;
  const legacyKey = `system.scale.${classIdentifier}.cantrips-known`;
  const effects = [];
  const seen = new Set();

  const addEffect = (effect) => {
    if (!effect || effect.disabled) return;
    const key = effect.uuid ?? `${effect.parent?.uuid ?? ""}.${effect.id ?? effects.length}`;
    if (seen.has(key)) return;
    seen.add(key);
    effects.push(effect);
  };

  for (const effect of actor.effects ?? []) addEffect(effect);
  for (const item of actor.items ?? []) {
    for (const effect of item.effects ?? []) {
      if (effect.transfer === false) continue;
      addEffect(effect);
    }
  }

  let total = 0;
  let count = 0;

  for (const effect of effects) {
    const changes = effect.system?.changes ?? effect.changes ?? [];
    for (const change of changes) {
      if (![currentKey, legacyKey].includes(change?.key)) continue;

      const type = String(change?.type ?? "").toLowerCase();
      const mode = Number(change?.mode ?? NaN);
      const isAdd = type === "add"
        || mode === Number(globalThis.CONST?.ACTIVE_EFFECT_MODES?.ADD ?? 2);
      if (!isAdd) continue;

      const value = Number(change?.value);
      if (!Number.isFinite(value)) continue;

      total += value;
      count += 1;
    }
  }

  return { total, count };
}

function scaleNumber(value) {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  if (typeof value === "object") {
    const direct = scaleNumber(value.value);
    if (direct != null) return direct;
  }
  return null;
}

/**
 * Build a map of embedded Item ID -> the actor Item whose Advancement directly added it.
 * Supports the nested `added` structures used by both Grant Items and Choose Items.
 */
function buildAdvancementProvenance(actor) {
  const provenance = new Map();

  for (const sourceItem of actor.items ?? []) {
    const advancements = sourceItem.system?.advancement;
    if (!advancements) continue;

    for (const advancement of advancements) {
      const added = advancement?.value?.added;
      if (!added) continue;
      collectAddedItems(added, actor, sourceItem, advancement, provenance, 0, new WeakSet());
    }
  }

  return provenance;
}

function collectAddedItems(node, actor, sourceItem, advancement, provenance, depth, seen) {
  if (depth > 10 || node == null) return;

  if (node instanceof Map) {
    for (const [key, value] of node.entries()) {
      inspectAddedEntry(key, value, actor, sourceItem, advancement, provenance, depth, seen);
    }
    return;
  }

  if (typeof node !== "object") return;
  if (seen.has(node)) return;
  seen.add(node);

  for (const [key, value] of Object.entries(node)) {
    inspectAddedEntry(key, value, actor, sourceItem, advancement, provenance, depth, seen);
  }
}

function inspectAddedEntry(key, value, actor, sourceItem, advancement, provenance, depth, seen) {
  if (typeof value === "string" && actor.items?.has?.(key)) {
    provenance.set(key, { sourceItem, advancement, originalUuid: value });
    return;
  }

  if (value && typeof value === "object") {
    collectAddedItems(value, actor, sourceItem, advancement, provenance, depth + 1, seen);
  }
}

function resolveProvenance(actor, spell, advancementProvenance) {
  const advancementOrigin = advancementProvenance.get(spell.id);
  if (advancementOrigin?.sourceItem) {
    return {
      kind: "item",
      sourceItem: advancementOrigin.sourceItem,
      advancement: advancementOrigin.advancement,
      originalUuid: advancementOrigin.originalUuid,
      label: advancementOrigin.sourceItem.name,
      classLists: getSpellClassLists(actor, spell)
    };
  }

  const classLists = getSpellClassLists(actor, spell);
  if (classLists.length) {
    const listNames = classLists.map((list) => list.displayName);
    return {
      kind: "lists",
      sourceItem: null,
      advancement: null,
      originalUuid: getOriginalSpellUuid(spell),
      classLists,
      label: classLists.length === 1
        ? format("TCT.Provenance.List", { list: listNames[0] })
        : format("TCT.Provenance.Lists", { lists: formatList(listNames) })
    };
  }

  return {
    kind: "unknown",
    sourceItem: null,
    advancement: null,
    originalUuid: getOriginalSpellUuid(spell),
    classLists: [],
    label: getOriginalSpellUuid(spell)
      ? i18n("TCT.Provenance.NoRegisteredList")
      : i18n("TCT.Provenance.Unknown")
  };
}

function resolveAssignment(spell, classes, provenance) {
  const manual = spell.getFlag?.(MODULE_ID, ASSIGNMENT_FLAG)
    ?? spell.flags?.[MODULE_ID]?.[ASSIGNMENT_FLAG]
    ?? AUTO;
  return resolveAssignmentValue(manual, classes, provenance);
}

function resolveAssignmentValue(manual, classes, provenance) {
  if (manual && manual !== AUTO) {
    if (manual === OTHER) {
      return { kind: "other", reason: "manual-other", manual, onClassList: null };
    }
    if (manual === UNASSIGNED) {
      return { kind: "unassigned", reason: "manual-unassigned", manual, onClassList: null };
    }
    if (manual.startsWith("class:")) {
      const classId = manual.slice(6);
      const cls = classes.find((entry) => entry.id === classId);
      if (cls) {
        return {
          kind: "class",
          classId,
          reason: "manual-class",
          manual,
          onClassList: provenance.classLists.length
            ? provenance.classLists.some((list) => list.identifier === classId)
            : null
        };
      }
    }
  }

  return resolveAutomaticAssignment(classes, provenance);
}

function resolveAutomaticAssignment(classes, provenance) {
  if (provenance.kind === "item" && provenance.sourceItem) {
    const sourceItem = provenance.sourceItem;
    const advancementType = String(
      provenance.advancement?.type
      ?? provenance.advancement?.constructor?.name
      ?? ""
    );

    if (sourceItem.type === "class") {
      const classId = classIdentifier(sourceItem);
      const isChoice = advancementType.includes("ItemChoice");
      if (classId && classes.some((entry) => entry.id === classId) && isChoice) {
        return {
          kind: "class",
          classId,
          reason: "advancement-choice",
          manual: AUTO,
          onClassList: provenance.classLists.length
            ? provenance.classLists.some((list) => list.identifier === classId)
            : null
        };
      }
    }

    // A spell explicitly granted by an Item is outside a class-known quota unless the
    // class itself used a Choose Items advancement to consume one of its choices.
    return { kind: "other", reason: "advancement-grant", manual: AUTO, onClassList: null };
  }

  const actorClassIds = new Set(classes.map((entry) => entry.id));
  const candidates = provenance.classLists
    .filter((list) => actorClassIds.has(list.identifier))
    .map((list) => list.identifier);

  if (candidates.length === 1) {
    return {
      kind: "class",
      classId: candidates[0],
      reason: "single-actor-class-list",
      manual: AUTO,
      onClassList: true
    };
  }

  return {
    kind: "unassigned",
    reason: candidates.length > 1 ? "multiple-actor-class-lists" : "no-actor-class-list",
    candidates,
    manual: AUTO,
    onClassList: null
  };
}

function getSpellClassLists(actor, spell) {
  try {
    const registry = globalThis.dnd5e?.registry?.spellLists;
    if (!registry?.forSpell) return [];

    const uuid = getOriginalSpellUuid(spell);
    if (!uuid) return [];

    const lists = registry.forSpell(uuid);
    if (!lists) return [];

    const actorClassNames = new Map(
      Array.from(actor.items ?? [])
        .filter((item) => item.type === "class")
        .map((item) => [classIdentifier(item), item.name])
        .filter(([id]) => Boolean(id))
    );

    return Array.from(lists)
      .filter((list) => list?.metadata?.type === "class")
      .map((list) => {
        const identifier = list.metadata?.identifier ?? null;
        const registeredName = localizeMaybe(list.name ?? list.metadata?.name ?? identifier ?? "");
        return {
          identifier,
          displayName: actorClassNames.get(identifier) ?? registeredName,
          registeredName,
          list
        };
      })
      .filter((entry) => entry.identifier)
      .sort((a, b) => a.displayName.localeCompare(b.displayName, game.i18n?.lang ?? undefined));
  } catch (error) {
    console.warn(`${MODULE_ID} | Could not resolve spell lists for ${spell.name}`, error);
    return [];
  }
}

function getOriginalSpellUuid(spell) {
  return spell?._stats?.compendiumSource
    ?? spell?.flags?.core?.sourceId
    ?? null;
}

async function openDetails(actor) {
  const report = buildReport(actor);
  const canEdit = Boolean(actor.isOwner);
  const draft = {
    deleted: new Set(),
    assignments: new Map(
      report.rows.map((row) => [
        row.spell.id,
        row.spell.getFlag?.(MODULE_ID, ASSIGNMENT_FLAG) ?? AUTO
      ])
    )
  };

  const content = renderDraftDialog(report, draft, canEdit);
  const DialogV2 = foundry.applications.api.DialogV2;
  const buttons = [];

  if (canEdit && report.rows.length) {
    buttons.push({
      action: "save",
      label: i18n("TCT.Action.Save"),
      icon: "fa-solid fa-floppy-disk",
      default: true,
      callback: (_event, button) => {
        const formData = new FormData(button.form);
        const assignments = {};
        for (const [key, value] of formData.entries()) {
          if (key.startsWith("assignment-")) assignments[key.slice(11)] = String(value);
        }
        return { assignments, deletedIds: Array.from(draft.deleted) };
      }
    });
  }

  buttons.push({
    action: "cancel",
    label: i18n("TCT.Action.Cancel"),
    icon: "fa-solid fa-xmark"
  });

  const result = await DialogV2.wait({
    window: { title: format("TCT.Dialog.Title", { actor: actor.name }) },
    content,
    buttons,
    rejectClose: false,
    modal: false,
    render: (_event, dialog) => {
      if (canEdit) initializeDraftDialog(dialog.element, report, draft);
    }
  });

  if (!result || result === "cancel" || typeof result !== "object") return;
  if (!canEdit) {
    ui.notifications.warn(i18n("TCT.Notification.NoPermission"));
    return;
  }

  const deletedIds = Array.from(new Set(result.deletedIds ?? []))
    .filter((id) => actor.items?.has?.(id));

  if (deletedIds.length) {
    const confirmed = await DialogV2.confirm({
      window: { title: i18n("TCT.Delete.ConfirmTitle") },
      content: `<p>${escapeHtml(format("TCT.Delete.ConfirmMessage", {
        count: deletedIds.length,
        actor: actor.name
      }))}</p>`,
      yes: {
        label: format("TCT.Delete.ConfirmButton", { count: deletedIds.length }),
        icon: "fa-solid fa-trash"
      },
      no: {
        label: i18n("TCT.Action.Cancel"),
        icon: "fa-solid fa-xmark"
      },
      rejectClose: false,
      modal: true
    });
    if (!confirmed) return;
  }

  const updates = [];
  for (const row of report.rows) {
    if (deletedIds.includes(row.spell.id)) continue;
    const assignment = String(result.assignments?.[row.spell.id] ?? draft.assignments.get(row.spell.id) ?? AUTO);
    const current = row.spell.getFlag?.(MODULE_ID, ASSIGNMENT_FLAG) ?? AUTO;
    if (assignment === current) continue;
    updates.push({
      _id: row.spell.id,
      [`flags.${MODULE_ID}.${ASSIGNMENT_FLAG}`]: assignment
    });
  }

  if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
  if (deletedIds.length) await actor.deleteEmbeddedDocuments("Item", deletedIds);
  if (!updates.length && !deletedIds.length) return;

  ui.notifications.info(format("TCT.Notification.SavedChanges", {
    updated: updates.length,
    deleted: deletedIds.length
  }));
  actor.sheet?.render?.({ force: true });
}

function renderDraftDialog(report, draft, canEdit) {
  const preview = buildDraftPreview(report, draft);
  const classPills = preview.classes
    .filter((entry) => entry.max != null || entry.count > 0)
    .map((entry) => draftClassPill(entry))
    .join("");

  const otherPill = `<span class="tct-dialog__pill" data-tct-preview="other" ${preview.other ? "" : "hidden"}>${escapeHtml(format("TCT.Summary.Other", { count: preview.other }))}</span>`;
  const unassignedPill = `<span class="tct-dialog__pill is-warning" data-tct-preview="unassigned" ${preview.unassigned ? "" : "hidden"}>${escapeHtml(`⚠ ${format("TCT.Summary.ToAssign", { count: preview.unassigned })}`)}</span>`;

  const selectionHeader = canEdit
    ? `<th scope="col" class="tct-table__select"><input type="checkbox" data-tct-select-all aria-label="${escapeAttribute(i18n("TCT.Delete.SelectAll"))}"></th>`
    : "";
  const actionHeader = canEdit
    ? `<th scope="col" class="tct-table__actions">${escapeHtml(i18n("TCT.Dialog.Actions"))}</th>`
    : "";

  const rows = report.rows.length
    ? report.rows.map((row) => renderDialogRow(row, report.classes, preview.classMap, canEdit, draft)).join("")
    : `<tr><td colspan="${canEdit ? 6 : 4}">${escapeHtml(i18n("TCT.Dialog.NoCantrips"))}</td></tr>`;

  const bulkControls = canEdit && report.rows.length
    ? `<div class="tct-dialog__bulk">
        <span data-tct-selected-count>${escapeHtml(format("TCT.Delete.SelectedCount", { count: 0 }))}</span>
        <button type="button" class="tct-bulk-delete" data-tct-bulk-delete disabled>
          <i class="fa-solid fa-trash" aria-hidden="true"></i>
          ${escapeHtml(i18n("TCT.Delete.Selected"))}
        </button>
      </div>`
    : "";

  return `
    <div class="tct-dialog">
      <p class="tct-dialog__help">${escapeHtml(i18n("TCT.Dialog.Help"))}</p>
      <div class="tct-dialog__summary">${classPills}${otherPill}${unassignedPill}</div>
      <div class="tct-table-wrap">
        <table class="tct-table">
          <thead>
            <tr>
              ${selectionHeader}
              <th scope="col">${escapeHtml(i18n("TCT.Dialog.Spell"))}</th>
              <th scope="col">${escapeHtml(i18n("TCT.Dialog.Assignment"))}</th>
              <th scope="col">${escapeHtml(i18n("TCT.Dialog.Source"))}</th>
              <th scope="col">${escapeHtml(i18n("TCT.Dialog.Status"))}</th>
              ${actionHeader}
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      ${bulkControls}
      <div class="tct-dialog__footer" data-tct-preview="total">${escapeHtml(format("TCT.Dialog.Total", { count: preview.total }))}</div>
    </div>`;
}

function draftClassPill(entry) {
  const maxText = entry.max ?? "?";
  const text = format("TCT.Summary.ClassCount", {
    class: entry.name,
    count: entry.count,
    max: maxText
  });
  return `<span class="tct-dialog__pill ${entry.over ? "is-over" : ""}" data-tct-class-id="${escapeAttribute(entry.id)}">${escapeHtml(entry.over ? `⚠ ${text}` : text)}</span>`;
}

function renderDialogRow(row, classes, classMap, canEdit, draft) {
  const manual = draft.assignments.get(row.spell.id)
    ?? row.spell.getFlag?.(MODULE_ID, ASSIGNMENT_FLAG)
    ?? AUTO;
  const automatic = resolveAutomaticAssignment(classes, row.provenance);
  const automaticDestination = assignmentLabel(automatic, classes);
  const automaticLabel = format("TCT.Assignment.AutomaticResolved", { assignment: automaticDestination });
  const options = [
    option(AUTO, automaticLabel, manual),
    ...classes.map((entry) => option(`class:${entry.id}`, entry.name, manual)),
    option(OTHER, i18n("TCT.Assignment.Other"), manual),
    option(UNASSIGNED, i18n("TCT.Assignment.Unassigned"), manual)
  ].join("");

  const assignment = resolveAssignmentValue(manual, classes, row.provenance);
  const previewRow = { ...row, ...assignment };
  const status = statusForRow(previewRow, classMap);
  const assignedLabel = assignmentLabel(previewRow, classes);
  const assignmentControl = canEdit
    ? `<select name="assignment-${escapeAttribute(row.spell.id)}" data-tct-assignment data-spell-id="${escapeAttribute(row.spell.id)}" aria-label="${escapeAttribute(format("TCT.Accessibility.AssignmentFor", { spell: row.spell.name }))}">${options}</select>`
    : escapeHtml(assignedLabel);

  const selectCell = canEdit
    ? `<td class="tct-table__select"><input type="checkbox" data-tct-select data-spell-id="${escapeAttribute(row.spell.id)}" aria-label="${escapeAttribute(format("TCT.Delete.SelectSpell", { spell: row.spell.name }))}"></td>`
    : "";
  const actionCell = canEdit
    ? `<td class="tct-table__actions">
        <button type="button" class="tct-row-delete" data-tct-delete data-spell-id="${escapeAttribute(row.spell.id)}" aria-label="${escapeAttribute(format("TCT.Delete.MarkSpell", { spell: row.spell.name }))}" title="${escapeAttribute(i18n("TCT.Delete.Mark"))}">
          <i class="fa-solid fa-trash" aria-hidden="true"></i>
        </button>
      </td>`
    : "";

  return `
    <tr data-tct-row data-spell-id="${escapeAttribute(row.spell.id)}">
      ${selectCell}
      <td class="tct-table__spell"><strong>${escapeHtml(row.spell.name)}</strong><span class="tct-pending-delete-label" hidden>${escapeHtml(i18n("TCT.Status.PendingDelete"))}</span></td>
      <td class="tct-table__assignment">${assignmentControl}</td>
      <td class="tct-table__source">${escapeHtml(row.provenance.label)}</td>
      <td class="tct-table__status"><span class="tct-status ${status.warning ? "is-warning" : ""}" data-tct-status><span aria-hidden="true">${status.icon}</span> ${escapeHtml(status.label)}</span></td>
      ${actionCell}
    </tr>`;
}

function initializeDraftDialog(element, report, draft) {
  const root = element.querySelector(".tct-dialog");
  if (!root) return;

  const refresh = () => updateDraftDialog(root, report, draft);

  root.querySelectorAll("[data-tct-assignment]").forEach((select) => {
    select.addEventListener("change", () => {
      draft.assignments.set(select.dataset.spellId, select.value);
      refresh();
    });
  });

  root.querySelectorAll("[data-tct-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.spellId;
      if (draft.deleted.has(id)) draft.deleted.delete(id);
      else draft.deleted.add(id);
      refresh();
    });
  });

  root.querySelector("[data-tct-bulk-delete]")?.addEventListener("click", () => {
    root.querySelectorAll("[data-tct-select]:checked").forEach((checkbox) => {
      draft.deleted.add(checkbox.dataset.spellId);
      checkbox.checked = false;
    });
    refresh();
  });

  root.querySelector("[data-tct-select-all]")?.addEventListener("change", (event) => {
    const checked = event.currentTarget.checked;
    root.querySelectorAll("[data-tct-select]").forEach((checkbox) => {
      if (!checkbox.disabled) checkbox.checked = checked;
    });
    updateDraftSelectionControls(root);
  });

  root.querySelectorAll("[data-tct-select]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => updateDraftSelectionControls(root));
  });

  refresh();
}

function updateDraftDialog(root, report, draft) {
  const preview = buildDraftPreview(report, draft);

  for (const cls of preview.classes) {
    const pill = root.querySelector(`[data-tct-class-id="${cssEscape(cls.id)}"]`);
    if (!pill) continue;
    const text = format("TCT.Summary.ClassCount", {
      class: cls.name,
      count: cls.count,
      max: cls.max ?? "?"
    });
    pill.textContent = cls.over ? `⚠ ${text}` : text;
    pill.classList.toggle("is-over", cls.over);
  }

  const otherPill = root.querySelector('[data-tct-preview="other"]');
  if (otherPill) {
    otherPill.hidden = preview.other === 0;
    otherPill.textContent = format("TCT.Summary.Other", { count: preview.other });
  }

  const unassignedPill = root.querySelector('[data-tct-preview="unassigned"]');
  if (unassignedPill) {
    unassignedPill.hidden = preview.unassigned === 0;
    unassignedPill.textContent = `⚠ ${format("TCT.Summary.ToAssign", { count: preview.unassigned })}`;
  }

  const total = root.querySelector('[data-tct-preview="total"]');
  if (total) total.textContent = format("TCT.Dialog.Total", { count: preview.total });

  for (const row of report.rows) {
    const rowElement = root.querySelector(`[data-tct-row][data-spell-id="${cssEscape(row.spell.id)}"]`);
    if (!rowElement) continue;

    const deleted = draft.deleted.has(row.spell.id);
    rowElement.classList.toggle("is-pending-delete", deleted);

    const select = rowElement.querySelector("[data-tct-select]");
    if (select) {
      select.disabled = deleted;
      if (deleted) select.checked = false;
    }

    const assignmentControl = rowElement.querySelector("[data-tct-assignment]");
    if (assignmentControl) assignmentControl.disabled = deleted;

    const pendingLabel = rowElement.querySelector(".tct-pending-delete-label");
    if (pendingLabel) pendingLabel.hidden = !deleted;

    const deleteButton = rowElement.querySelector("[data-tct-delete]");
    if (deleteButton) {
      deleteButton.classList.toggle("is-restore", deleted);
      deleteButton.title = i18n(deleted ? "TCT.Delete.Restore" : "TCT.Delete.Mark");
      deleteButton.setAttribute(
        "aria-label",
        format(deleted ? "TCT.Delete.RestoreSpell" : "TCT.Delete.MarkSpell", { spell: row.spell.name })
      );
      const icon = deleteButton.querySelector("i");
      if (icon) icon.className = deleted ? "fa-solid fa-rotate-left" : "fa-solid fa-trash";
    }

    const statusNode = rowElement.querySelector("[data-tct-status]");
    if (statusNode) {
      if (deleted) {
        statusNode.classList.remove("is-warning");
        statusNode.innerHTML = `<span aria-hidden="true">🗑</span> ${escapeHtml(i18n("TCT.Status.PendingDelete"))}`;
      } else {
        const manual = draft.assignments.get(row.spell.id) ?? AUTO;
        const assignment = resolveAssignmentValue(manual, report.classes, row.provenance);
        const previewRow = { ...row, ...assignment };
        const status = statusForRow(previewRow, preview.classMap);
        statusNode.classList.toggle("is-warning", status.warning);
        statusNode.innerHTML = `<span aria-hidden="true">${status.icon}</span> ${escapeHtml(status.label)}`;
      }
    }
  }

  updateDraftSelectionControls(root);
}

function updateDraftSelectionControls(root) {
  const selected = Array.from(root.querySelectorAll("[data-tct-select]:checked")).length;
  const counter = root.querySelector("[data-tct-selected-count]");
  if (counter) counter.textContent = format("TCT.Delete.SelectedCount", { count: selected });

  const bulkButton = root.querySelector("[data-tct-bulk-delete]");
  if (bulkButton) bulkButton.disabled = selected === 0;

  const selectAll = root.querySelector("[data-tct-select-all]");
  if (selectAll) {
    const enabled = Array.from(root.querySelectorAll("[data-tct-select]:not(:disabled)"));
    const checked = enabled.filter((checkbox) => checkbox.checked).length;
    selectAll.checked = enabled.length > 0 && checked === enabled.length;
    selectAll.indeterminate = checked > 0 && checked < enabled.length;
  }
}

function buildDraftPreview(report, draft) {
  const classes = report.classes.map((entry) => ({
    ...entry,
    spells: [],
    count: 0,
    over: false
  }));
  const classMap = new Map(classes.map((entry) => [entry.id, entry]));
  let other = 0;
  let unassigned = 0;
  let total = 0;

  for (const row of report.rows) {
    if (draft.deleted.has(row.spell.id)) continue;
    total += 1;

    const manual = draft.assignments.get(row.spell.id)
      ?? row.spell.getFlag?.(MODULE_ID, ASSIGNMENT_FLAG)
      ?? AUTO;
    const assignment = resolveAssignmentValue(manual, classes, row.provenance);

    if (assignment.kind === "class" && classMap.has(assignment.classId)) {
      const cls = classMap.get(assignment.classId);
      cls.spells.push(row.spell);
      cls.count += 1;
    } else if (assignment.kind === "other") {
      other += 1;
    } else {
      unassigned += 1;
    }
  }

  for (const cls of classes) {
    cls.over = cls.max != null && cls.count > cls.max;
  }

  return { classes, classMap, other, unassigned, total };
}

function assignmentLabel(row, classes) {
  if (row.kind === "class") {
    return classes.find((entry) => entry.id === row.classId)?.name ?? row.classId;
  }
  if (row.kind === "other") return i18n("TCT.Assignment.Other");
  return i18n("TCT.Assignment.Unassigned");
}

function statusForRow(row, classMap) {
  if (row.kind === "unassigned") {
    return { warning: true, icon: "⚠", label: i18n("TCT.Status.NeedsAssignment") };
  }

  if (row.kind === "class") {
    if (row.onClassList === false) {
      return { warning: true, icon: "⚠", label: i18n("TCT.Status.NotOnClassList") };
    }
    if (classMap.get(row.classId)?.over) {
      return { warning: true, icon: "⚠", label: i18n("TCT.Status.OverLimit") };
    }
    return { warning: false, icon: "✓", label: i18n("TCT.Status.Valid") };
  }

  if (row.kind === "other") {
    const granted = row.provenance.kind === "item" && row.reason === "advancement-grant";
    return {
      warning: false,
      icon: "✓",
      label: i18n(granted ? "TCT.Status.Granted" : "TCT.Status.Other")
    };
  }

  return { warning: false, icon: "✓", label: i18n("TCT.Status.Valid") };
}

function option(value, label, selectedValue) {
  const selected = value === selectedValue ? " selected" : "";
  return `<option value="${escapeAttribute(value)}"${selected}>${escapeHtml(label)}</option>`;
}

function formatList(values) {
  const clean = Array.from(new Set(values.filter(Boolean)));
  if (!clean.length) return "";
  try {
    const formatter = game.i18n?.getListFormatter?.({ style: "long", type: "conjunction" });
    if (formatter?.format) return formatter.format(clean);
  } catch (error) {
    console.debug(`${MODULE_ID} | Falling back to comma-separated list`, error);
  }
  return clean.join(", ");
}

function localizeMaybe(value) {
  const text = String(value ?? "");
  if (!text) return "";
  try {
    return game.i18n?.has?.(text) ? game.i18n.localize(text) : text;
  } catch (_error) {
    return text;
  }
}

function i18n(key) {
  return game.i18n.localize(key);
}

function format(key, data) {
  return game.i18n.format(key, data);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function cssEscape(value) {
  if (globalThis.CSS?.escape) return CSS.escape(String(value));
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}
