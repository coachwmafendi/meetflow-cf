import { zoneLabel } from "../lib/timezoneList";
import { escapeHtml } from "./layout";

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
 * Renders a timezone `<select>` holding only the current value.
 *
 * The full IANA list is filled in by TIMEZONE_SCRIPT in the browser, not here:
 * labelling all 418 zones needs one Intl.DateTimeFormat per zone, which measured
 * at ~95ms of CPU — far past a Worker's per-request budget. The browser does the
 * same work off the critical path for free.
 *
 * Without JavaScript the control still shows and submits the saved zone
 * correctly; it just cannot be changed from this page.
 */
export function timezoneSelect({ name, selected, autodetect }: TimezoneSelectOptions): string {
  const id = escapeHtml(name);
  return `
    <select class="mf-input" id="${id}" name="${id}" data-timezone${
      autodetect ? " data-timezone-autodetect" : ""
    } required>
      <option value="${escapeHtml(selected)}" selected>${escapeHtml(zoneLabel(selected))}</option>
    </select>`;
}

/**
 * Populates every `[data-timezone]` select with the runtime's full zone list,
 * sorted by current UTC offset then city, labelled "+08:00 Kuala Lumpur".
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

      Array.prototype.forEach.call(selects, function (select) {
        var want = select.hasAttribute("data-timezone-autodetect") && detected
          ? detected
          : select.value;

        var fragment = document.createDocumentFragment();
        var matched = false;
        items.forEach(function (item) {
          var option = document.createElement("option");
          option.value = item.value;
          option.textContent = item.text;
          if (item.value === want) { option.selected = true; matched = true; }
          fragment.appendChild(option);
        });

        // Keep an unrecognised stored value selectable rather than silently
        // rewriting the host's timezone on the next save.
        if (!matched && want) {
          var keep = document.createElement("option");
          keep.value = want;
          keep.textContent = want;
          keep.selected = true;
          fragment.insertBefore(keep, fragment.firstChild);
        }

        select.innerHTML = "";
        select.appendChild(fragment);
      });
    })();
  </script>`;
