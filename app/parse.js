const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TAG_RE = /#[^\s#\[\]!]+/gu;
const PROJECT_RE = /\[\[([^\]]+)\]\]/g;
const DEADLINE_RE = /!((?:\d{4}-\d{2}-\d{2})|(?:\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?))/g;

/**
 * Parse Things capture syntax without touching the DOM. Natural dates are
 * supplied by the caller so this module can stay Node-importable and pure.
 */
export function parseCapture(raw, options = {}) {
  const config = typeof options?.parse === "function" ? { chrono: options } : options || {};
  const { chrono = null, referenceDate = new Date() } = config;
  const source = String(raw ?? "");
  const ranges = [];
  const tags = [];
  let projectName = null;
  let deadline = null;

  for (const match of source.matchAll(TAG_RE)) {
    tags.push(match[0].slice(1));
    ranges.push([match.index, match.index + match[0].length]);
  }

  for (const match of source.matchAll(PROJECT_RE)) {
    if (projectName == null) projectName = match[1].trim() || null;
    ranges.push([match.index, match.index + match[0].length]);
  }

  for (const match of source.matchAll(DEADLINE_RE)) {
    deadline = normalizeDate(match[1], referenceDate);
    ranges.push([match.index, match.index + match[0].length]);
  }

  let when = "inbox";
  if (chrono && typeof chrono.parse === "function") {
    const searchable = maskRanges(source, ranges);
    let results;
    try {
      results = chrono.parse(searchable, referenceDate, { forwardDate: true });
    } catch {
      results = chrono.parse(searchable, referenceDate);
    }
    const natural = (Array.isArray(results) ? results : []).find(result => {
      const text = String(result?.text ?? "");
      const start = Number.isInteger(result?.index) ? result.index : searchable.indexOf(text);
      const end = start + text.length;
      return start >= 0 && !ranges.some(([from, to]) => start < to && end > from);
    });
    if (natural) {
      const date = resultDate(natural);
      const text = String(natural.text ?? "");
      const start = Number.isInteger(natural.index) ? natural.index : searchable.indexOf(text);
      if (date && start >= 0 && text) {
        when = date;
        ranges.push([start, start + text.length]);
      }
    }
  }

  return {
    title: cleanTitle(source, ranges),
    when,
    tags,
    projectName,
    deadline,
  };
}

function maskRanges(source, ranges) {
  const chars = source.split("");
  for (const [from, to] of ranges) {
    for (let index = from; index < to; index += 1) chars[index] = " ";
  }
  return chars.join("");
}

function cleanTitle(source, ranges) {
  if (!ranges.length) return source.trim();
  const title = maskRanges(source, ranges)
    .replace(/[ \t]+/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/[;,.:]\s*$/, "")
    .trim();
  return title;
}

function resultDate(result) {
  const start = result?.start;
  const value = typeof start?.date === "function" ? start.date() : start?.date ?? start?.value;
  if (value instanceof Date && Number.isFinite(value.getTime())) return formatDate(value);
  if (typeof value === "string" && DATE_RE.test(value)) return value;
  const known = start?.knownValues;
  if (known?.year && known?.month && known?.day) {
    return [known.year, known.month, known.day].map((part, index) => index === 0 ? String(part) : String(part).padStart(2, "0")).join("-");
  }
  return null;
}

function normalizeDate(value, referenceDate) {
  if (DATE_RE.test(value)) return value;
  const parts = value.split(/[/-]/).map(Number);
  if (parts.length !== 2 && parts.length !== 3) return null;
  let [month, day, year] = parts;
  if (!year) year = referenceDate.getFullYear();
  if (year < 100) year += 2000;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return [year, month, day].map((part, index) => index === 0 ? String(part) : String(part).padStart(2, "0")).join("-");
}

function formatDate(date) {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part, index) => index === 0 ? String(part) : String(part).padStart(2, "0"))
    .join("-");
}
