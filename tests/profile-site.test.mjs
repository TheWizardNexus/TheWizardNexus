import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyReferenceQuality, compareReferenceSeries, summarizeOfficialRange } from "../scripts/telemetry-quality.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFile(path.join(ROOT, relativePath), "utf8");
const json = async (relativePath) => JSON.parse(await read(relativePath));
const textById = (html, id) => html.match(new RegExp(`<[^>]+\\bid="${id}"[^>]*>([^<]*)</[^>]+>`, "i"))?.[1];

test("curated ecosystem accounts for every published interface without confusing sites and source", async () => {
  const projects = await json("data/projects.json");
  const slugs = projects.published.map((project) => project.slug);
  const urls = projects.published.map((project) => project.url);
  const stages = new Map(projects.published.map((project) => [project.slug, project.stage]));

  assert.equal(projects.published.length, 13);
  assert.equal(projects.publishingNext.length, 3);
  assert.equal(new Set(slugs).size, slugs.length);
  assert.equal(new Set(urls).size, urls.length);
  assert.ok(projects.published.every((project) => project.url.startsWith("https://")));
  assert.ok(projects.published.every((project) => project.sourceStatus.trim().length > 0));
  assert.ok(projects.published.every((project) => project.sourceBoundary.trim().length > 0));
  assert.ok(projects.published.every((project) => project.maturity.trim().length > 0));
  assert.ok(projects.published.every((project) => project.stage.trim().length > 0));
  assert.ok(projects.publishingNext.every((project) => project.stage === "Development"));
  assert.equal(stages.get("arcane-os"), "Development");
  assert.equal(stages.get("dbopfs"), "Released 1.0.0");
  assert.equal(stages.get("twin-compass"), "Released 1.0.0");
  assert.equal(stages.get("scamurai"), "Pre-release");
  assert.equal(stages.get("redress"), "Inside ARCANE");
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

test("rolling NPM totals are exact sums of persisted official range series", async () => {
  const snapshot = await json("data/npm-stats.json");
  const names = snapshot.packages.map((pkg) => pkg.name);

  assert.equal(snapshot.schemaVersion, 2);
  assert.equal(snapshot.maintainer, "thewizardnexus");
  assert.match(snapshot.source.authority, /sole authority/i);
  assert.match(snapshot.source.downloads, /api\.npmjs\.org\/downloads\/range/);
  assert.ok(snapshot.source.officialUrls.every((url) => /^https:\/\/api\.npmjs\.org\/downloads\/range\//.test(url)));
  assert.equal(snapshot.packageCount, snapshot.packages.length);
  assert.equal(new Set(names).size, names.length);
  assert.ok(snapshot.packages.every((pkg) => pkg.maintainers.some((name) => name.toLowerCase() === snapshot.maintainer)));
  for (const period of ["week", "month", "year"]) {
    for (const pkg of snapshot.packages) {
      const validated = summarizeOfficialRange({
        start: snapshot.periods[period].start,
        end: snapshot.periods[period].end,
        downloads: pkg.series[period],
      }, `persisted ${pkg.name} ${period} range`);
      assert.equal(pkg.downloads[period], pkg.series[period].reduce((sum, point) => sum + point.downloads, 0));
      assert.equal(pkg.downloads[period], validated.total);
      assert.equal(pkg.series[period][0].day, snapshot.periods[period].start);
      assert.equal(pkg.series[period].at(-1).day, snapshot.periods[period].end);
    }
    assert.equal(snapshot.totals[period], snapshot.packages.reduce((sum, pkg) => sum + pkg.downloads[period], 0));
    assert.match(snapshot.periods[period].start, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(snapshot.periods[period].end, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test("NPM history publishes only the official range series and treats comparison data as optional", async () => {
  const history = await json("data/npm-history.json");

  assert.equal(history.schemaVersion, 2);
  assert.match(history.source.authority, /sole authority/i);
  assert.match(history.source.referenceRole, /optional, non-authoritative/i);
  assert.ok([...history.source.availabilityUrls, ...history.source.officialUrls]
    .every((url) => /^https:\/\/api\.npmjs\.org\/downloads\/range\//.test(url)));
  assert.equal(history.packageCount, history.packages.length);
  assert.equal(history.dates.length, history.overall.length);
  assert.ok(history.packages.every((pkg) => pkg.downloads.length === history.dates.length));
  assert.ok(history.packages.every((pkg) => pkg.total === pkg.downloads.reduce((sum, value) => sum + value, 0)));
  assert.deepEqual(
    history.overall,
    history.dates.map((_, index) => history.packages.reduce((sum, pkg) => sum + pkg.downloads[index], 0)),
  );
  assert.equal(history.total, history.overall.reduce((sum, value) => sum + value, 0));
  assert.equal(history.dataQuality.officialTotal, history.total);
  assert.equal(history.dataQuality.publishedTotalSource, "official npm range series");
  if (history.dataQuality.referenceAvailable) {
    assert.equal(history.dataQuality.officialMinusNpmStat, history.total - history.dataQuality.npmStatReferenceTotal);
    assert.equal(
      history.dataQuality.exactMatch,
      history.dataQuality.correctedPointCount === 0 && history.dataQuality.referenceMissingPointCount === 0,
    );
  } else {
    assert.equal(history.dataQuality.npmStatReferenceTotal, null);
    assert.equal(history.dataQuality.officialMinusNpmStat, null);
    assert.equal(history.dataQuality.correctedPointCount, null);
    assert.equal(history.dataQuality.referenceMissingPointCount, null);
    assert.equal(history.dataQuality.exactMatch, false);
    assert.match(history.dataQuality.status, /optional npm-stat comparison unavailable/i);
  }
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

test("official range validation rejects missing daily rows", () => {
  assert.throws(() => summarizeOfficialRange({
    start: "2026-08-11",
    end: "2026-08-13",
    downloads: [
      { day: "2026-08-11", downloads: 5 },
      { day: "2026-08-13", downloads: 3 },
    ],
  }), /missing or misorders the official day 2026-08-12/);
});

test("npm-stat zeros, omissions, differences, malformed values, and outages never change the official total", () => {
  const officialDownloads = [
    { day: "2026-08-11", downloads: 5 },
    { day: "2026-08-12", downloads: 7 },
    { day: "2026-08-13", downloads: 3 },
  ];
  const unchangedOfficial = structuredClone(officialDownloads);
  const comparisons = [
    compareReferenceSeries({ officialDownloads, referencePoints: { "2026-08-11": 0, "2026-08-12": 0, "2026-08-13": 0 } }),
    compareReferenceSeries({ officialDownloads, referencePoints: { "2026-08-11": 5, "2026-08-13": 3 } }),
    compareReferenceSeries({ officialDownloads, referencePoints: null }),
    compareReferenceSeries({ officialDownloads, referencePoints: { "2026-08-11": 10, "2026-08-12": 10, "2026-08-13": 10 } }),
    compareReferenceSeries({ officialDownloads, referencePoints: { "2026-08-11": "malformed" } }),
  ];
  assert.ok(comparisons.every((comparison) => comparison.officialTotal === 15));
  assert.deepEqual(officialDownloads, unchangedOfficial);
  assert.equal(comparisons[0].npmStatReferenceTotal, 0);
  assert.equal(comparisons[1].referenceMissingPointCount, 1);
  assert.equal(comparisons[2].npmStatReferenceTotal, null);
  assert.equal(comparisons[2].officialMinusNpmStat, null);
  assert.equal(comparisons[3].officialMinusNpmStat, -15);
  assert.equal(comparisons[4].referenceAvailable, false);
  assert.equal(comparisons[4].npmStatReferenceTotal, null);

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

  assert.equal(cancelling.officialMinusReference, 0);
  assert.equal(cancelling.exactMatch, false);
  assert.equal(missingZero.exactMatch, false);
  assert.equal(unavailable.exactMatch, false);
  assert.equal(unavailable.officialMinusReference, null);
});

test("the public nexus uses focused pages while preserving the complete ecosystem record", async () => {
  const pageNames = ["index.html", "ecosystem.html", "practice.html", "trust.html", "people.html", "code.html", "signal.html", "work.html"];
  const [readme, pages, script, css, svg, history, generator, errorPage] = await Promise.all([
    read("README.md"),
    Promise.all(pageNames.map(read)),
    read("app.js"),
    read("styles.css"),
    read("assets/twin-signal.svg"),
    json("data/npm-history.json"),
    read("scripts/update-profile-data.mjs"),
    read("404.html"),
  ]);
  const byName = new Map(pageNames.map((name, index) => [name, pages[index]]));
  const officialTotal = history.total.toLocaleString("en-US");

  assert.match(readme, /assets\/twin-signal\.svg/);
  assert.match(readme, /thewizardnexus\.github\.io\/TheWizardNexus/);
  for (const pageName of pageNames.slice(1)) assert.match(byName.get("index.html"), new RegExp(`href="${pageName}"`));
  assert.doesNotMatch(byName.get("index.html"), /id="project-grid"|id="repo-grid"|id="npm-chart"/);
  assert.match(byName.get("ecosystem.html"), /id="project-grid"/);
  assert.match(byName.get("ecosystem.html"), /The complete directory remains available without scripts/);
  assert.match(byName.get("practice.html"), /Optimize[\s\S]*Detect[\s\S]*Prevent[\s\S]*Intervene/);
  assert.match(byName.get("trust.html"), /Stage before spectacle/);
  assert.match(byName.get("people.html"), /Johanna “JZ” Zollmann, LCSW/);
  assert.match(byName.get("people.html"), /href="https:\/\/www\.linkedin\.com\/in\/turtlesallthewaydown\/"/);
  assert.match(byName.get("code.html"), /id="repo-grid"/);
  assert.match(byName.get("code.html"), /Public code remains available without scripts/);
  assert.match(byName.get("signal.html"), /id="npm-chart"/);
  assert.doesNotMatch(byName.get("signal.html"), /Loading (?:the TWiN NPM|daily values|the latest public snapshot)/);
  assert.match(byName.get("work.html"), /The dojo is open/);
  assert.match(errorPage, /href="\/TheWizardNexus\/styles\.css"/);
  assert.match(errorPage, /href="\/TheWizardNexus\/ecosystem\.html"/);
  for (const html of pages) {
    assert.match(html, /href="styles\.css"/);
    assert.match(html, /src="app\.js"/);
    assert.match(html, /class="site-header"/);
  }
  assert.match(script, /data\/projects\.json/);
  assert.match(script, /stage-badge/);
  assert.match(script, /aria-label="Open \$\{escapeHtml\(project\.name\)\} — \$\{escapeHtml\(maturity\)\}"/);
  assert.match(script, /data\/repos\.json/);
  assert.match(script, /data\/npm-history\.json/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(svg, /TWiN PUBLIC ECOSYSTEM/);
  assert.match(svg, /PROJECT SITES/);
  assert.match(svg, /MAPPED POINTS/);
  assert.match(readme, new RegExp(`${officialTotal} official npm range downloads`));
  assert.match(svg, new RegExp(`${officialTotal} official-range downloads`));
  assert.match(svg, new RegExp(`${history.total} official npm range downloads`));
  assert.match(generator, /ecosystem\.html/);
  assert.match(generator, /code\.html/);
  assert.match(generator, /signal\.html/);
  assert.doesNotMatch(generator, /downloads\/point/);
  assert.match(generator, /downloads\/range/);
});

test("every focused page has canonical metadata and every internal HTML route resolves", async () => {
  const pageNames = ["index.html", "ecosystem.html", "practice.html", "trust.html", "people.html", "code.html", "signal.html", "work.html"];
  const [pages, rootEntries, robots, sitemap, workflow] = await Promise.all([
    Promise.all(pageNames.map(read)),
    readdir(ROOT),
    read("robots.txt"),
    read("sitemap.xml"),
    read(".github/workflows/profile-site.yml"),
  ]);
  const canonicalRoot = "https://thewizardnexus.github.io/TheWizardNexus/";

  for (const [index, html] of pages.entries()) {
    const pageName = pageNames[index];
    const canonical = pageName === "index.html" ? canonicalRoot : `${canonicalRoot}${pageName}`;
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(new Set(ids).size, ids.length, `${pageName} should not contain duplicate IDs`);
    assert.equal([...html.matchAll(/<h1\b/g)].length, 1, `${pageName} should contain one primary heading`);
    assert.match(html, new RegExp(`<link rel="canonical" href="${canonical}"`));
    assert.match(html, new RegExp(`<meta property="og:url" content="${canonical}"`));
    assert.match(html, /<meta property="og:image" content="https:\/\/thewizardnexus\.github\.io\/TheWizardNexus\/assets\/twin-ecosystem-og\.png">/);
    assert.match(html, /<meta name="twitter:title" content="[^"]+">/);
    assert.match(html, /<meta name="twitter:description" content="[^"]+">/);
    assert.match(html, /<meta name="twitter:image:alt" content="[^"]+">/);
    assert.match(sitemap, new RegExp(`<loc>${canonical}</loc>`));
    const localLinks = [...html.matchAll(/<a\b[^>]*\bhref="([^"#]+\.html)"/g)].map((match) => match[1]);
    for (const link of localLinks) assert.ok(rootEntries.includes(link), `${pageName} links to missing ${link}`);
  }
  assert.equal([...sitemap.matchAll(/<loc>/g)].length, pageNames.length);
  assert.match(robots, new RegExp(`${canonicalRoot}sitemap\\.xml`));
  assert.match(workflow, /branches: \[main\]/);
  assert.match(workflow, /node --check app\.js/);
  assert.match(workflow, /node --test tests\/profile-site\.test\.mjs/);
  assert.match(workflow, /actions\/configure-pages@/);
  assert.match(workflow, /actions\/upload-pages-artifact@/);
  assert.match(workflow, /actions\/deploy-pages@/);
  assert.match(workflow, /path: \./);
});

test("no-script telemetry fallbacks agree across the focused pages", async () => {
  const [home, ecosystem, code, signal, projects, repos, npm, history] = await Promise.all([
    read("index.html"),
    read("ecosystem.html"),
    read("code.html"),
    read("signal.html"),
    json("data/projects.json"),
    json("data/repos.json"),
    json("data/npm-stats.json"),
    json("data/npm-history.json"),
  ]);
  const expectations = [
    [home, { "project-total": projects.published.length, "mapped-points": projects.mapSnapshot.points, "mapped-relationships": projects.mapSnapshot.relationships, "repo-total-hero": repos.counts.total }],
    [ecosystem, { "project-total": projects.published.length, "mapped-points": projects.mapSnapshot.points, "mapped-relationships": projects.mapSnapshot.relationships, "next-total": projects.publishingNext.length }],
    [code, { "repo-total": repos.counts.total, "repo-original": repos.counts.original, "repo-stars": repos.counts.stars }],
    [signal, { "project-total": projects.published.length, "mapped-points": projects.mapSnapshot.points, "mapped-relationships": projects.mapSnapshot.relationships, "repo-total": repos.counts.total, "npm-history-total": history.total.toLocaleString("en-US"), "npm-week": npm.totals.week.toLocaleString("en-US"), "npm-month": npm.totals.month.toLocaleString("en-US"), "npm-year": npm.totals.year.toLocaleString("en-US") }],
  ];
  for (const [html, pageExpectations] of expectations) {
    for (const [id, expected] of Object.entries(pageExpectations)) {
      assert.equal(textById(html, id), String(expected), `#${id} should agree with its generated snapshot`);
    }
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
