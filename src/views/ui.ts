import { escapeHtml } from "./escape";

/**
 * The component layer. Pages compose these instead of hand-writing markup, so
 * spacing, states and focus behaviour stay identical everywhere.
 *
 * Convention: every parameter typed `string` is escaped here. Parameters named
 * `*Html` are trusted and must already be safe.
 */

/* -------------------------------------------------------------------------- */
/* Icons                                                                       */
/* -------------------------------------------------------------------------- */

const ICON_PATHS = {
  calendar:
    '<path d="M8 2v3M16 2v3M3.5 9.1h17M21 8.5V17a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V8.5a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 1.8"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.1 0l3-3a5 5 0 0 0-7.1-7.1L11.3 4.6"/><path d="M14 11a5 5 0 0 0-7.1 0l-3 3a5 5 0 0 0 7.1 7.1l1.7-1.7"/>',
  check: '<path d="m4.5 12.5 5 5 10-11"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrowLeft: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 20.5a8 8 0 0 1 16 0"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-3-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-3l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.9-1.2V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 3 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.6 1Z"/>',
  layers: '<path d="m12 2.5 9 5-9 5-9-5 9-5Z"/><path d="m3 12.5 9 5 9-5"/>',
  inbox:
    '<path d="M3 12h5l2 3h4l2-3h5"/><path d="M5.5 4.5h13l2.5 7.5v5a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-5l2.5-7.5Z"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  alert:
    '<path d="M12 8.5v4.5M12 16.5h.01"/><path d="M10.3 3.9 2.6 17.1A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.9L13.7 3.9a2 2 0 0 0-3.4 0Z"/>',
  globe:
    '<circle cx="12" cy="12" r="9"/><path d="M3.2 9h17.6M3.2 15h17.6"/><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18Z"/>',
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
  chevronLeft: '<path d="m15 6-6 6 6 6"/>',
  grid:
    '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  logOut: '<path d="M9 21H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3h3"/><path d="m16 17 5-5-5-5M21 12H9"/>',
} as const;

export type IconName = keyof typeof ICON_PATHS;

export function icon(name: IconName, className = "size-4"): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="${escapeHtml(
    className,
  )}">${ICON_PATHS[name]}</svg>`;
}

/* -------------------------------------------------------------------------- */
/* Buttons                                                                     */
/* -------------------------------------------------------------------------- */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export interface ButtonOptions {
  label: string;
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  href?: string;
  type?: "button" | "submit";
  icon?: IconName;
  iconAfter?: IconName;
  className?: string;
  /** Accessible name when the label is visually redundant. */
  ariaLabel?: string;
}

export function button(options: ButtonOptions): string {
  const { label, variant = "secondary", size = "md", href, type = "submit" } = options;
  const classes = [
    "ui-btn",
    `ui-btn-${variant}`,
    size === "sm" ? "ui-btn-sm" : "",
    size === "lg" ? "ui-btn-lg" : "",
    options.className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  const inner = [
    options.icon ? icon(options.icon) : "",
    `<span>${escapeHtml(label)}</span>`,
    options.iconAfter ? icon(options.iconAfter) : "",
  ].join("");

  const aria = options.ariaLabel ? ` aria-label="${escapeHtml(options.ariaLabel)}"` : "";

  return href
    ? `<a class="${classes}" href="${escapeHtml(href)}"${aria}>${inner}</a>`
    : `<button class="${classes}" type="${type}"${aria}>${inner}</button>`;
}

/* -------------------------------------------------------------------------- */
/* Forms                                                                       */
/* -------------------------------------------------------------------------- */

export interface FieldOptions {
  name: string;
  label: string;
  type?: string;
  value?: string;
  hint?: string;
  required?: boolean;
  placeholder?: string;
  /** Raw attribute string, e.g. 'minlength="8"'. Author-controlled. */
  attrsHtml?: string;
  /** Replaces the input entirely — used for selects and custom controls. */
  controlHtml?: string;
  className?: string;
}

export function field(options: FieldOptions): string {
  const {
    name,
    label,
    type = "text",
    value = "",
    required = true,
    placeholder = "",
    hint,
  } = options;
  const id = escapeHtml(name);

  const control =
    options.controlHtml ??
    `<input class="ui-input" id="${id}" name="${id}" type="${escapeHtml(type)}"
       value="${escapeHtml(value)}"${placeholder ? ` placeholder="${escapeHtml(placeholder)}"` : ""}
       ${required ? "required" : ""} ${options.attrsHtml ?? ""}
       ${hint ? `aria-describedby="${id}-hint"` : ""}>`;

  return `<div class="ui-fieldset ${escapeHtml(options.className ?? "")}">
      <label class="ui-label" for="${id}">${escapeHtml(label)}</label>
      ${control}
      ${hint ? `<p class="ui-hint" id="${id}-hint">${escapeHtml(hint)}</p>` : ""}
    </div>`;
}

/* -------------------------------------------------------------------------- */
/* Feedback                                                                    */
/* -------------------------------------------------------------------------- */

export function alert(variant: "danger" | "success", message: string): string {
  return `<div class="ui-alert ui-alert-${variant}" role="${
    variant === "danger" ? "alert" : "status"
  }">
      ${icon(variant === "danger" ? "alert" : "check", "size-4 shrink-0 mt-px")}
      <span>${escapeHtml(message)}</span>
    </div>`;
}

export function badge(
  variant: "neutral" | "success" | "danger",
  label: string,
  withDot = true,
): string {
  const dot =
    withDot && variant !== "neutral"
      ? `<span class="size-1.5 rounded-full bg-current opacity-70"></span>`
      : "";
  return `<span class="ui-badge ui-badge-${variant}">${dot}${escapeHtml(label)}</span>`;
}

/* -------------------------------------------------------------------------- */
/* Structure                                                                   */
/* -------------------------------------------------------------------------- */

export interface PageHeaderOptions {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  /** Trusted markup, typically buttons. */
  actionsHtml?: string;
}

export function pageHeader({ title, subtitle, eyebrow, actionsHtml }: PageHeaderOptions): string {
  return `<header class="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        ${eyebrow ? `<p class="ui-eyebrow mb-1.5">${escapeHtml(eyebrow)}</p>` : ""}
        <h1 class="ui-title">${escapeHtml(title)}</h1>
        ${subtitle ? `<p class="ui-subtitle">${escapeHtml(subtitle)}</p>` : ""}
      </div>
      ${actionsHtml ? `<div class="flex items-center gap-2">${actionsHtml}</div>` : ""}
    </header>`;
}

export interface EmptyStateOptions {
  icon: IconName;
  title: string;
  body: string;
  actionHtml?: string;
}

export function emptyState({ icon: name, title, body, actionHtml }: EmptyStateOptions): string {
  return `<div class="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div class="mb-3.5 flex size-10 items-center justify-center rounded-full border border-line bg-subtle text-muted">
        ${icon(name, "size-[18px]")}
      </div>
      <p class="text-sm font-medium text-ink">${escapeHtml(title)}</p>
      <p class="mt-1 max-w-xs text-[0.8125rem] text-muted">${escapeHtml(body)}</p>
      ${actionHtml ? `<div class="mt-5">${actionHtml}</div>` : ""}
    </div>`;
}

export interface TableOptions {
  columns: Array<{ label: string; align?: "left" | "right" }>;
  /** Each row is a list of trusted cell markup. */
  rowsHtml: string[][];
  emptyHtml?: string;
}

export function table({ columns, rowsHtml, emptyHtml }: TableOptions): string {
  if (rowsHtml.length === 0 && emptyHtml) return emptyHtml;

  const head = columns
    .map(
      (c) =>
        `<th scope="col"${c.align === "right" ? ' class="text-right"' : ""}>${escapeHtml(
          c.label,
        )}</th>`,
    )
    .join("");

  const body = rowsHtml
    .map(
      (cells, i) =>
        `<tr class="ui-rise" style="animation-delay:${Math.min(i, 8) * 28}ms">${cells
          .map(
            (cell, ci) =>
              `<td${columns[ci]?.align === "right" ? ' class="text-right"' : ""}>${cell}</td>`,
          )
          .join("")}</tr>`,
    )
    .join("");

  return `<table class="ui-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

/** A number with its label — the dashboard's top row. */
export function statTile(label: string, value: string | number, iconName: IconName): string {
  return `<div class="ui-card ui-card-pad">
      <div class="flex items-center justify-between">
        <p class="ui-eyebrow">${escapeHtml(label)}</p>
        <span class="text-muted">${icon(iconName, "size-[15px]")}</span>
      </div>
      <p class="ui-time mt-2.5 text-[1.75rem] font-semibold leading-none text-ink">${escapeHtml(
        String(value),
      )}</p>
    </div>`;
}

/**
 * Host avatar: the uploaded image when there is one, otherwise initials.
 * `sizeClass` must set both dimensions (e.g. "size-12").
 */
export function avatar(
  name: string,
  avatarKey: string | null,
  sizeClass = "size-12",
  textClass = "text-base",
): string {
  const size = escapeHtml(sizeClass);

  if (avatarKey) {
    return `<img src="/${escapeHtml(avatarKey)}" alt="${escapeHtml(name)}"
              class="${size} shrink-0 rounded-full border border-line object-cover"
              loading="lazy" decoding="async">`;
  }

  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0] ?? "")
      .join("")
      .toUpperCase() || "?";

  return `<span class="${size} ${escapeHtml(textClass)} flex shrink-0 items-center justify-center
                rounded-full border border-line bg-subtle font-semibold tracking-tight text-ink"
            aria-hidden="true">${escapeHtml(initials)}</span>`;
}

/** Monospaced time/date, the product's typographic signature. */
export function time(text: string, className = ""): string {
  return `<span class="ui-time ${escapeHtml(className)}">${escapeHtml(text)}</span>`;
}
