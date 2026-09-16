import { zoneLabel } from "../lib/timezoneList";
import { escapeHtml } from "./layout";
import { icon } from "./ui";

export interface TimezoneSelectOptions {
  /** Form field name. */
  name: string;
  /** Currently stored IANA zone, rendered as the initial option. */
  selected: string;
  /**
   * Replace the initial selection with the visitor's own zone once the list is
   * populated. Used on registration, where the server has nothing better than
   * the "UTC" default to show.
   */
  autodetect?: boolean;
}

/**
 * Renders a searchable timezone combobox.
 *
 * A hidden native `<select>` still exists for form submission and no-JS
 * fallbacks. The visible dropdown is built by TIMEZONE_SCRIPT in the browser and
 * includes a search input that filters by city or IANA zone.
 */
export function timezoneSelect({ name, selected, autodetect }: TimezoneSelectOptions): string {
  const id = escapeHtml(name);
  const initialLabel = escapeHtml(zoneLabel(selected));
  return `
    <div class="relative" data-tz-select>
      <button type="button" class="ui-input flex w-full items-center justify-between gap-2 text-left" data-tz-trigger aria-haspopup="listbox" aria-expanded="false">
        <span data-tz-label>${initialLabel}</span>
        ${icon("chevronDown", "size-4 text-muted")}
      </button>
      <div class="absolute z-20 mt-1 hidden w-full overflow-hidden rounded-md border border-line-strong bg-surface shadow-lg" data-tz-dropdown>
        <input type="text" class="block w-full border-b border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted focus:outline-none" placeholder="Search timezone or city…" data-tz-search>
        <div class="max-h-[16rem] overflow-y-auto" data-tz-list role="listbox"></div>
      </div>
      <select class="sr-only" id="${id}" name="${id}" data-timezone${
        autodetect ? " data-timezone-autodetect" : ""
      } required>
        <option value="${escapeHtml(selected)}" selected>${initialLabel}</option>
      </select>
    </div>`;
}

/**
 * Turns every `[data-timezone]` hidden select into a searchable combobox.
 * The full IANA list is built in the browser, sorted by current UTC offset
 * then city, labelled "+08:00 Kuala Lumpur".
 *
 * The offset maths mirrors src/lib/timezone.ts. It is duplicated rather than
 * imported because this runs in the browser, not the Worker.
 */
export const TIMEZONE_SCRIPT = `
  <script>
    (function () {
      var selects = document.querySelectorAll("[data-timezone]");
      if (!selects.length || typeof Intl.supportedValuesOf !== "function") return;

      var now = new Date();

      function offsetMinutes(zone) {
        var parts = new Intl.DateTimeFormat("en-US", {
          timeZone: zone, hour12: false,
          year: "numeric", month: "2-digit", day: "2-digit",
          hour: "2-digit", minute: "2-digit", second: "2-digit"
        }).formatToParts(now);
        var get = function (t) {
          for (var i = 0; i < parts.length; i++) if (parts[i].type === t) return Number(parts[i].value);
          return 0;
        };
        var asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
        return (asUtc - Math.floor(now.getTime() / 1000) * 1000) / 60000;
      }

      function label(offset, zone) {
        var sign = offset < 0 ? "-" : "+";
        var abs = Math.abs(offset);
        var hh = String(Math.floor(abs / 60));
        var mm = String(abs % 60);
        while (hh.length < 2) hh = "0" + hh;
        while (mm.length < 2) mm = "0" + mm;
        return sign + hh + ":" + mm + " " + zone.split("/").pop().replace(/_/g, " ");
      }

      var zones = Intl.supportedValuesOf("timeZone").slice();
      if (zones.indexOf("UTC") === -1) zones.push("UTC");

      var items = zones.map(function (zone) {
        var offset = offsetMinutes(zone);
        return { value: zone, offset: offset, text: label(offset, zone) };
      });
      items.sort(function (a, b) {
        return a.offset - b.offset || a.text.localeCompare(b.text);
      });

      var detected = "";
      try { detected = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) {}

      function initOne(select) {
        var wrapper = select.closest("[data-tz-select]");
        var trigger = wrapper.querySelector("[data-tz-trigger]");
        var dropdown = wrapper.querySelector("[data-tz-dropdown]");
        var list = wrapper.querySelector("[data-tz-list]");
        var search = wrapper.querySelector("[data-tz-search]");
        var labelEl = wrapper.querySelector("[data-tz-label]");

        var want = select.hasAttribute("data-timezone-autodetect") && detected
          ? detected
          : select.value;

        var selectFragment = document.createDocumentFragment();
        var matched = false;
        var buttons = [];

        function setValue(value) {
          select.value = value;
          select.dispatchEvent(new Event("change", { bubbles: true }));
          updateTrigger();
          close();
        }

        function updateTrigger() {
          var opt = select.querySelector('option[value="' + select.value + '"]');
          labelEl.textContent = opt ? opt.textContent : select.value;
        }

        function renderButton(item, active) {
          var btn = document.createElement("button");
          btn.type = "button";
          btn.className = "flex w-full items-center justify-between px-3 py-2 text-left text-sm " + (active ? "bg-subtle text-ink" : "text-body hover:bg-subtle hover:text-ink");
          btn.setAttribute("role", "option");
          btn.setAttribute("aria-selected", active ? "true" : "false");
          btn.setAttribute("data-tz-value", item.value);
          btn.textContent = item.text;
          return btn;
        }

        items.forEach(function (item) {
          var active = item.value === want;
          if (active) matched = true;

          var option = document.createElement("option");
          option.value = item.value;
          option.textContent = item.text;
          if (active) option.selected = true;
          selectFragment.appendChild(option);

          var btn = renderButton(item, active);
          buttons.push(btn);
          list.appendChild(btn);
        });

        if (!matched && want) {
          var option = document.createElement("option");
          option.value = want;
          option.textContent = want;
          option.selected = true;
          selectFragment.insertBefore(option, selectFragment.firstChild);

          var btn = renderButton({ value: want, text: want }, true);
          list.insertBefore(btn, list.firstChild);
        }

        select.innerHTML = "";
        select.appendChild(selectFragment);
        updateTrigger();

        function open() {
          dropdown.classList.remove("hidden");
          trigger.setAttribute("aria-expanded", "true");
          search.value = "";
          search.focus();
          buttons.forEach(function (btn) { btn.style.display = ""; });
        }

        function close() {
          dropdown.classList.add("hidden");
          trigger.setAttribute("aria-expanded", "false");
        }

        trigger.addEventListener("click", function (e) {
          e.preventDefault();
          if (dropdown.classList.contains("hidden")) open(); else close();
        });

        search.addEventListener("input", function () {
          var q = search.value.toLowerCase();
          buttons.forEach(function (btn) {
            var value = btn.getAttribute("data-tz-value").toLowerCase();
            var text = btn.textContent.toLowerCase();
            btn.style.display = (value.indexOf(q) !== -1 || text.indexOf(q) !== -1) ? "" : "none";
          });
        });

        search.addEventListener("keydown", function (e) {
          if (e.key === "Escape") { close(); trigger.focus(); }
        });

        list.addEventListener("click", function (e) {
          var btn = e.target.closest("[data-tz-value]");
          if (!btn) return;
          list.querySelectorAll("[data-tz-value]").forEach(function (b) {
            var active = b === btn;
            b.setAttribute("aria-selected", active ? "true" : "false");
            b.className = active
              ? "flex w-full items-center justify-between px-3 py-2 text-left text-sm bg-subtle text-ink"
              : "flex w-full items-center justify-between px-3 py-2 text-left text-sm text-body hover:bg-subtle hover:text-ink";
          });
          setValue(btn.getAttribute("data-tz-value"));
        });

        document.addEventListener("click", function (e) {
          if (!wrapper.contains(e.target)) close();
        });
      }

      Array.prototype.forEach.call(selects, initOne);
    })();
  </script>`;
