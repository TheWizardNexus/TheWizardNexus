import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyReferenceQuality } from "../scripts/telemetry-quality.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFile(path.join(ROOT, relativePath), "utf8");
const json = async (relativePath) => JSON.parse(await read(relativePath));
const textById = (html, id) => html.match(new RegExp(`<[^>]+\\bid="${id}"[^>]*>([^<]*)</[^>]+>`, "i"))?.[1];

test("curated ecosystem accounts for every published interface without confusing sites and source", async () => {
  const projects = await json("data/projects.json");
  const slugs = projects.published.map((project) => project.slug);
  const urls = projects.published.map((project) => project.url);

  assert.equal(projects.published.length, 13);
  assert.equal(projects.publishingNext.length, 3);
  assert.equal(new Set(slugs).size, slugs.length);
  assert.equal(new Set(urls).size, urls.length);
  assert.ok(projects.published.every((project) => project.url.startsWith("https://")));
  assert.ok(projects.published.every((project) => project.sourceStatus.trim().length > 0));
  assert.ok(projects.mapSnapshot.points >= 78);
  assert.ok(projects.mapSnapshot.relationships >= 171);
  assert.equal(projects.mapSnapshot.rings, 8);
  assert.ok(projects.mapSnapshot.dataUrl.startsWith("https://raw.githubusercontent.com/TheWizardNexus/Astrolabe/"));
});

test("public code atlas accounts for every repository and labels each record", async () => {
  const snapshot = await json("data/repos.json");
  const names = snapshot.repositories.map((repo) => repo.fullName);

  assert.equal(snapshot.counts.total, snapshot.repositories.length);
  assert.equal(new Set(names).size, names.length);
  assert.equal(snapshot.counts.original + snapshot.counts.forks, snapshot.counts.total);
  assert.equal(snapshot.counts.stars, snapshot.repositories.reduce((sum, repo) => sum + repo.stars, 0));
  assert.ok(snapshot.repositories.every((repo) => repo.explanation.trim().length > 0));
  assert.ok(snapshot.repositories.every((repo) => repo.url.startsWith("https://github.com/TheWizardNexus/")));
  assert.ok(snapshot.repositories.every((repo) => repo.license !== "NOASSERTION"));
});

test("rolling NPM totals are exact sums of the maintained package inventory", async () => {
  const snapshot = await json("data/npm-stats.json");
  const names = snapshot.packages.map((pkg) => pkg.name);

  assert.equal(snapshot.maintainer, "thewizardnexus");
  assert.equal(snapshot.packageCount, snapshot.packages.length);
  assert.equal(new Set(names).size, names.length);
  assert.ok(snapshot.packages.every((pkg) => pkg.maintainers.some((name) => name.toLowerCase() === snapshot.maintainer)));
  for (const period of ["week", "month", "year"]) {
    assert.equal(snapshot.totals[period], snapshot.packages.reduce((sum, pkg) => sum + pkg.downloads[period], 0));
    assert.match(snapshot.periods[period].start, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(snapshot.periods[period].end, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test("NPM history uses the latest finalized day and reconciles the reference series", async () => {
  const history = await json("data/npm-history.json");

  assert.equal(history.packageCount, history.packages.length);
  assert.equal(history.dates.length, history.overall.length);
  assert.ok(history.packages.every((pkg) => pkg.downloads.length === history.dates.length));
  assert.equal(history.total, history.overall.reduce((sum, value) => sum + value, 0));
  assert.equal(history.dataQuality.officialTotal, history.total);
  assert.equal(history.dataQuality.referenceAvailable, true);
  assert.equal(history.dataQuality.correction, history.total - history.dataQuality.npmStatReferenceTotal);
  assert.equal(
    history.dataQuality.exactMatch,
    history.dataQuality.correctedPointCount === 0 && history.dataQuality.referenceMissingPointCount === 0,
  );
  assert.equal(history.period.availableFrom, history.dates[0]);
  assert.equal(history.period.availableUntil, history.dates.at(-1));
  assert.ok(history.period.availableUntil <= history.period.requestedUntil);
  assert.ok(history.source.referenceView.includes("author=thewizardnexus"));
  if (history.total > 0) {
    assert.ok(history.firstRecordedDay);
    assert.ok(history.peakDay);
    assert.ok(history.peakDay.downloads > 0);
  }
});

test("reference quality never labels cancelling or missing discrepancies as an exact match", () => {
  const cancelling = classifyReferenceQuality({
    referenceAvailable: true,
    officialTotal: 12,
    referenceTotal: 12,
    correctedPointCount: 2,
    referenceMissingPointCount: 0,
  });
  const missingZero = classifyReferenceQuality({
    referenceAvailable: true,
    officialTotal: 12,
    referenceTotal: 12,
    correctedPointCount: 0,
    referenceMissingPointCount: 1,
  });
  const unavailable = classifyReferenceQuality({
    referenceAvailable: false,
    officialTotal: 12,
    referenceTotal: null,
    correctedPointCount: null,
    referenceMissingPointCount: null,
  });

  assert.equal(cancelling.correction, 0);
  assert.equal(cancelling.exactMatch, false);
  assert.equal(missingZero.exactMatch, false);
  assert.equal(unavailable.exactMatch, false);
  assert.equal(unavailable.correction, null);
});

test("README and static site expose the ecosystem atlas and compact NPM signal", async () => {
  const [readme, html, script, css, svg] = await Promise.all([
    read("README.md"),
    read("index.html"),
    read("app.js"),
    read("styles.css"),
    read("assets/twin-signal.svg"),
  ]);

  assert.match(readme, /assets\/twin-signal\.svg/);
  assert.match(readme, /thewizardnexus\.github\.io\/TheWizardNexus/);
  assert.match(html, /id="project-grid"/);
  assert.match(html, /id="repo-grid"/);
  assert.match(html, /id="npm-chart"/);
  assert.match(script, /data\/projects\.json/);
  assert.match(script, /data\/repos\.json/);
  assert.match(script, /data\/npm-history\.json/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(svg, /TWiN PUBLIC ECOSYSTEM/);
  assert.match(svg, /MAPPED POINTS/);
});

test("no-script HTML telemetry agrees with the generated data snapshots", async () => {
  const [html, projects, repos, npm, history] = await Promise.all([
    read("index.html"),
    json("data/projects.json"),
    json("data/repos.json"),
    json("data/npm-stats.json"),
    json("data/npm-history.json"),
  ]);

  const expectations = {
    "project-total": projects.published.length,
    "mapped-points": projects.mapSnapshot.points,
    "mapped-relationships": projects.mapSnapshot.relationships,
    "repo-total-hero": repos.counts.total,
    "repo-total": repos.counts.total,
    "repo-original": repos.counts.original,
    "repo-stars": repos.counts.stars,
    "npm-history-total": history.total.toLocaleString("en-US"),
    "npm-week": npm.totals.week.toLocaleString("en-US"),
    "npm-month": npm.totals.month.toLocaleString("en-US"),
    "npm-year": npm.totals.year.toLocaleString("en-US"),
  };
  for (const [id, expected] of Object.entries(expectations)) {
    assert.equal(textById(html, id), String(expected), `#${id} should agree with its generated snapshot`);
  }
});

test("implementation introduces no TypeScript, TSX, or TypeScript toolchain", async () => {
  const forbidden = [];

  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "dist") continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      if (entry.isFile() && (/\.(ts|tsx)$/i.test(entry.name) || /^tsconfig(?:\..+)?\.json$/i.test(entry.name))) {
        forbidden.push(path.relative(ROOT, fullPath));
      }
    }
  }

  await walk(ROOT);
  assert.deepEqual(forbidden, []);
});
