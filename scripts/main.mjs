const MODULE_ID = "tidy-cantrip-tracker";
const ASSIGNMENT_FLAG = "assignment";
const AUTO = "auto";
const OTHER = "bonus";      // Kept for backward compatibility with v0.1.0 flags.
const UNASSIGNED = "unknown"; // Kept for backward compatibility with v0.1.0 flags.

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

    renderTracker(element, actor);
  } catch (error) {
    console.error(`${MODULE_ID} | Unable to render cantrip tracker`, error);
  }
});

function renderTracker(element, actor) {
  element.querySelectorAll(`.tct-summary[data-actor-id="${cssEscape(actor.id)}"]`).forEach((node) => node.remove());

  const report = buildReport(actor);
  if (!report.shouldDisplay) return;

  // Modern/Quadrone Tidy sheets expose "actor-name". Keep fallbacks for
  // alternate/older Tidy layouts so the tracker fails gracefully across layouts.
  const anchor = element.querySelector('[data-tidy-sheet-part="actor-name"]')
    ?? element.querySelector('[data-tidy-sheet-part="name-container"]')
    ?? element.querySelector('[data-tidy-sheet-part="name-header-row"]');
  if (!anchor) {
    console.warn(`${MODULE_ID} | Could not find a Tidy header anchor for ${actor.name}`);
    return;
  }

  const summary = document.createElement("div");
  summary.className = "tct-summary";
  summary.dataset.actorId = actor.id;
  summary.dataset.tidyRenderScheme = "handlebars";
  summary.tabIndex = 0;
  summary.setAttribute("role", "button");
  summary.setAttribute("aria-label", i18n("TCT.Accessibility.OpenTracker"));
  summary.title = i18n("TCT.Accessibility.OpenTracker");

  const label = document.createElement("span");
  label.className = "tct-summary__label";
  label.textContent = `${i18n("TCT.Summary.Header")} :`;
  summary.append(label);

  for (const classInfo of report.classes) {
    if (classInfo.max == null && classInfo.count === 0) continue;

    const maxText = classInfo.max ?? "?";
    const over = classInfo.max != null && classInfo.count > classInfo.max;
    const text = format("TCT.Summary.ClassCount", {
      class: classInfo.name,
      count: classInfo.count,
      max: maxText
    });
    const ariaLabel = classInfo.max == null
      ? format("TCT.Accessibility.ClassQuotaUnknown", { class: classInfo.name, count: classInfo.count })
      : over
        ? format("TCT.Accessibility.OverQuota", { class: classInfo.name, count: classInfo.count, max: classInfo.max })
        : format("TCT.Accessibility.ClassQuota", { class: classInfo.name, count: classInfo.count, max: classInfo.max });

    summary.append(makeChip(over ? `⚠ ${text}` : text, { over, title: ariaLabel }));
  }

  if (report.other.length) {
    summary.append(makeChip(
      format("TCT.Summary.Other", { count: report.other.length }),
      { title: format("TCT.Accessibility.Other", { count: report.other.length }) }
    ));
  }

  if (report.unassigned.length) {
    summary.append(makeChip(
      `⚠ ${format("TCT.Summary.ToAssign", { count: report.unassigned.length })}`,
      { warn: true, title: format("TCT.Accessibility.ToAssign", { count: report.unassigned.length }) }
    ));
  }

  summary.addEventListener("click", () => openDetails(actor));
  summary.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openDetails(actor);
    }
  });

  anchor.insertAdjacentElement("afterend", summary);
}

function makeChip(text, { warn = false, over = false, title = "" } = {}) {
  const chip = document.createElement("span");
  chip.className = "tct-chip";
  if (warn) chip.classList.add("tct-chip--warn");
  if (over) chip.classList.add("tct-chip--over");
  chip.textContent = text;
  if (title) {
    chip.title = title;
    chip.setAttribute("aria-label", title);
  }
  return chip;
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
  if (!scales || typeof scales !== "object") return null;

  const preferred = scales["cantrips-known"] ?? scales.cantripsKnown;
  const preferredValue = scaleNumber(preferred);
  if (preferredValue != null) return preferredValue;

  for (const [key, value] of Object.entries(scales)) {
    const normalized = String(key).toLowerCase();
    if (!normalized.includes("cantrip")) continue;
    if (!normalized.includes("known") && !normalized.includes("know")) continue;
    const number = scaleNumber(value);
    if (number != null) return number;
  }

  return null;
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
      label: format("TCT.Provenance.Lists", { lists: formatList(listNames) })
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
        const registeredName = localizeMaybe(list.metadata?.name ?? identifier ?? "");
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
  const classMap = new Map(report.classes.map((entry) => [entry.id, entry]));

  const classPills = report.classes
    .filter((entry) => entry.max != null || entry.count > 0)
    .map((entry) => {
      const maxText = entry.max ?? "?";
      const text = format("TCT.Summary.ClassCount", {
        class: entry.name,
        count: entry.count,
        max: maxText
      });
      const cls = entry.over ? "is-over" : "";
      return `<span class="tct-dialog__pill ${cls}">${escapeHtml(entry.over ? `⚠ ${text}` : text)}</span>`;
    })
    .join("");

  const otherPill = report.other.length
    ? `<span class="tct-dialog__pill">${escapeHtml(format("TCT.Summary.Other", { count: report.other.length }))}</span>`
    : "";
  const unassignedPill = report.unassigned.length
    ? `<span class="tct-dialog__pill is-warning">${escapeHtml(`⚠ ${format("TCT.Summary.ToAssign", { count: report.unassigned.length })}`)}</span>`
    : "";

  const rows = report.rows.length
    ? report.rows.map((row) => renderDialogRow(row, report.classes, classMap, canEdit)).join("")
    : `<tr><td colspan="4">${escapeHtml(i18n("TCT.Dialog.NoCantrips"))}</td></tr>`;

  const content = `
    <div class="tct-dialog">
      <p class="tct-dialog__help">${escapeHtml(i18n("TCT.Dialog.Help"))}</p>
      <div class="tct-dialog__summary">${classPills}${otherPill}${unassignedPill}</div>
      <div class="tct-table-wrap">
        <table class="tct-table">
          <thead>
            <tr>
              <th scope="col">${escapeHtml(i18n("TCT.Dialog.Spell"))}</th>
              <th scope="col">${escapeHtml(i18n("TCT.Dialog.Assignment"))}</th>
              <th scope="col">${escapeHtml(i18n("TCT.Dialog.Source"))}</th>
              <th scope="col">${escapeHtml(i18n("TCT.Dialog.Status"))}</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="tct-dialog__footer">${escapeHtml(format("TCT.Dialog.Total", { count: report.cantrips.length }))}</div>
    </div>`;

  const DialogV2 = foundry.applications.api.DialogV2;
  const buttons = [];

  if (canEdit && report.rows.length) {
    buttons.push({
      action: "save",
      label: i18n("TCT.Action.Save"),
      icon: "fa-solid fa-floppy-disk",
      default: true,
      callback: (_event, button) => {
        const data = {};
        const formData = new FormData(button.form);
        for (const [key, value] of formData.entries()) data[key] = value;
        return data;
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
    modal: false
  });

  if (!result || result === "cancel" || typeof result !== "object") return;
  if (!canEdit) {
    ui.notifications.warn(i18n("TCT.Notification.NoPermission"));
    return;
  }

  const updates = [];
  for (const row of report.rows) {
    const key = `assignment-${row.spell.id}`;
    if (!(key in result)) continue;
    const assignment = String(result[key] ?? AUTO);
    const current = row.spell.getFlag?.(MODULE_ID, ASSIGNMENT_FLAG) ?? AUTO;
    if (assignment === current) continue;

    updates.push({
      _id: row.spell.id,
      [`flags.${MODULE_ID}.${ASSIGNMENT_FLAG}`]: assignment
    });
  }

  if (!updates.length) return;
  await actor.updateEmbeddedDocuments("Item", updates);
  ui.notifications.info(i18n("TCT.Notification.Saved"));
  actor.sheet?.render?.({ force: true });
}

function renderDialogRow(row, classes, classMap, canEdit) {
  const manual = row.spell.getFlag?.(MODULE_ID, ASSIGNMENT_FLAG) ?? AUTO;
  const options = [
    option(AUTO, i18n("TCT.Assignment.Auto"), manual),
    ...classes.map((entry) => option(`class:${entry.id}`, entry.name, manual)),
    option(OTHER, i18n("TCT.Assignment.Other"), manual),
    option(UNASSIGNED, i18n("TCT.Assignment.Unassigned"), manual)
  ].join("");

  const status = statusForRow(row, classMap);
  const assignedLabel = assignmentLabel(row, classes);
  const assignmentControl = canEdit
    ? `<select name="assignment-${escapeAttribute(row.spell.id)}" aria-label="${escapeAttribute(format("TCT.Accessibility.AssignmentFor", { spell: row.spell.name }))}">${options}</select>`
    : escapeHtml(assignedLabel);

  return `
    <tr>
      <td class="tct-table__spell"><strong>${escapeHtml(row.spell.name)}</strong></td>
      <td class="tct-table__assignment">${assignmentControl}</td>
      <td class="tct-table__source">${escapeHtml(row.provenance.label)}</td>
      <td class="tct-table__status"><span class="tct-status ${status.warning ? "is-warning" : ""}"><span aria-hidden="true">${status.icon}</span> ${escapeHtml(status.label)}</span></td>
    </tr>`;
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
