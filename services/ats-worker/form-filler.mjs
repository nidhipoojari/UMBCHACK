// Fills an employer's public application form in a headless browser.
//
// Two rules hold throughout:
//   1. Nothing is submitted unless the caller asks and the deployment allows it
//      (see server.mjs). By default fill() types the values, takes a
//      screenshot for the applicant to review, and stops.
//   2. A posting on an ATS we do not recognise is never typed into. There is no
//      "guess which box is the email" fallback.

import { applicationUrl, providerForUrl, splitName } from "./providers.mjs";

const USER_AGENT = "agentHire-Agent/1.0";

// Full-page shots of long forms can be large. Above this we fall back to the
// visible part of the page so the response stays small.
const MAX_SCREENSHOT_BYTES = 3_000_000;

function log(event, fields) {
  console.log(JSON.stringify({ event, ...fields }));
}

/**
 * Fills a posting's application form and, only when told to, submits it.
 *
 * `planned` is the app's per-field plan ([{ selector, label, value }]) and is
 * typed first; it covers the custom questions no selector table knows about.
 * The provider's own table then fills the standard boxes the plan left alone.
 * A planned selector that matches nothing is reported as skipped.
 */
export async function fill({
  jobUrl,
  candidate,
  planned = [],
  submit = false,
  browserFactory,
  now = () => new Date().toISOString(),
}) {
  const provider = providerForUrl(jobUrl);
  if (!provider) {
    const record = {
      job_url: jobUrl,
      status: "unsupported_ats",
      submitted: false,
      fields_filled: [],
      fields_skipped: [],
      spoken_reason:
        "This posting is not on an applicant-tracking system the agent knows how to fill, so nothing was typed.",
      recorded_at: now(),
    };
    log("ats_apply_skipped", { job_url: jobUrl, status: record.status });
    return record;
  }

  const launch = browserFactory ?? (await defaultBrowserFactory());
  const browser = await launch();
  const context = await browser.newContext({ userAgent: USER_AGENT });
  const page = await context.newPage();
  const filled = [];
  const skipped = [];

  try {
    await page.goto(applicationUrl(jobUrl), { waitUntil: "domcontentloaded", timeout: 30_000 });
    // Forms such as Ashby's render in the browser after load.
    await page.waitForSelector("input, textarea, select", { timeout: 15_000 }).catch(() => {});

    const values = { ...candidate };
    const plannedSelectors = new Set();
    for (const entry of Array.isArray(planned) ? planned : []) {
      const selector = typeof entry?.selector === "string" ? entry.selector : "";
      const value = typeof entry?.value === "string" ? entry.value : "";
      if (!selector || !value.trim()) continue;

      const locator = page.locator(selector).first();
      if ((await locator.count()) === 0) {
        skipped.push({ field: entry.label ?? selector, reason: "no matching input on the page" });
        continue;
      }
      try {
        // fill() does nothing on a <select>; it needs selectOption.
        const tag = await locator.evaluate((node) => node.tagName.toLowerCase());
        if (tag === "select") await locator.selectOption({ label: value });
        else await locator.fill(value);
        plannedSelectors.add(selector);
        filled.push(entry.label ?? selector);
      } catch (error) {
        skipped.push({ field: entry.label ?? selector, reason: error.message.slice(0, 120) });
      }
    }

    if (provider.fields.full_name === null && candidate.full_name) {
      Object.assign(values, splitName(candidate.full_name));
    }

    for (const [field, selector] of Object.entries(provider.fields)) {
      if (!selector || values[field] === undefined || values[field] === null) continue;
      // Already answered by the plan; keep that answer.
      if (plannedSelectors.has(selector)) continue;
      const locator = page.locator(selector).first();
      if ((await locator.count()) === 0) {
        skipped.push({ field, reason: "no matching input on the page" });
        continue;
      }
      try {
        if (field === "resume_file") await locator.setInputFiles(values[field]);
        else await locator.fill(String(values[field]));
        filled.push(field);
      } catch (error) {
        skipped.push({ field, reason: error.message.slice(0, 120) });
      }
    }

    let shot = await page.screenshot({ fullPage: true, type: "png" });
    if (shot.length > MAX_SCREENSHOT_BYTES) shot = await page.screenshot({ fullPage: false, type: "png" });

    let submitted = false;
    let spokenReason;
    if (!submit) {
      spokenReason = `Prepared the ${provider.id} application for review. Nothing was submitted.`;
    } else {
      const button = page.locator(provider.submit).first();
      if ((await button.count()) === 0) {
        spokenReason = "The submit button was not found, so the application was left unsent.";
      } else {
        await button.click();
        await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
        submitted = true;
        spokenReason = `Submitted the ${provider.id} application for ${jobUrl}.`;
      }
    }

    const record = {
      job_url: jobUrl,
      provider: provider.id,
      status: submitted ? "submitted" : "prepared",
      submitted,
      fields_filled: filled,
      fields_skipped: skipped,
      spoken_reason: spokenReason,
      recorded_at: now(),
    };
    log(submitted ? "ats_apply_submitted" : "ats_apply_prepared", record);

    return { ...record, screenshot_png: shot.toString("base64") };
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

/** Loaded lazily so this module imports on a machine without Playwright. */
async function defaultBrowserFactory() {
  const { chromium } = await import("playwright");
  return () => chromium.launch({ headless: true });
}

/**
 * Lists every field on a posting's application form, for the app to plan
 * values against. Read-only: it opens the page, reads the form and closes;
 * nothing is typed or clicked.
 *
 * Each field's label is what a person would read: its <label>, else
 * aria-label or aria-labelledby, else the placeholder, else the name.
 * Fields with no readable label are dropped.
 */
export async function discover({ jobUrl, browserFactory, now = () => new Date().toISOString() }) {
  const provider = providerForUrl(jobUrl);
  const launch = browserFactory ?? (await defaultBrowserFactory());
  const browser = await launch();
  try {
    const context = await browser.newContext({ userAgent: USER_AGENT });
    const page = await context.newPage();
    await page.goto(applicationUrl(jobUrl), { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForSelector("input, textarea, select", { timeout: 20_000 }).catch(() => {});

    const fields = await page.evaluate(() => {
      const labelFor = (element) => {
        const id = element.getAttribute("id");
        if (id) {
          const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
          if (label?.innerText?.trim()) return label.innerText.trim();
        }
        const wrapping = element.closest("label");
        if (wrapping?.innerText?.trim()) return wrapping.innerText.trim();
        const aria = element.getAttribute("aria-label");
        if (aria?.trim()) return aria.trim();
        const labelledBy = element.getAttribute("aria-labelledby");
        if (labelledBy) {
          const target = document.getElementById(labelledBy);
          if (target?.innerText?.trim()) return target.innerText.trim();
        }
        return element.getAttribute("placeholder")?.trim() || element.getAttribute("name")?.trim() || "";
      };

      const selectorFor = (element) => {
        const name = element.getAttribute("name");
        if (name) return `${element.tagName.toLowerCase()}[name="${name}"]`;
        const id = element.getAttribute("id");
        if (id) return `#${CSS.escape(id)}`;
        return null;
      };

      const out = [];
      for (const element of document.querySelectorAll("input, textarea, select")) {
        const type = (element.getAttribute("type") || element.tagName).toLowerCase();
        if (["hidden", "submit", "button", "reset", "file"].includes(type)) continue;
        const selector = selectorFor(element);
        if (!selector) continue;

        const options =
          element.tagName.toLowerCase() === "select"
            ? [...element.options].map((option) => option.label || option.value).filter(Boolean)
            : undefined;

        const maxLength = Number(element.getAttribute("maxlength"));
        out.push({
          selector,
          label: labelFor(element).slice(0, 300),
          type,
          required: element.hasAttribute("required") || element.getAttribute("aria-required") === "true",
          options,
          maxLength: Number.isFinite(maxLength) && maxLength > 0 ? maxLength : null,
        });
      }
      return out.filter((field) => field.label.length > 0);
    });

    await context.close();
    return { job_url: jobUrl, provider: provider?.id ?? null, fields, discovered_at: now() };
  } finally {
    await browser.close().catch(() => {});
  }
}
