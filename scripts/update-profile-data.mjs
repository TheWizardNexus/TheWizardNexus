import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyReferenceQuality, compareReferenceSeries, summarizeOfficialRange } from "./telemetry-quality.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, "data");
const ASSET_DIR = path.join(ROOT, "assets");
const README_PATH = path.join(ROOT, "README.md");
const PROJECTS_PATH = path.join(DATA_DIR, "projects.json");
const SNAPSHOT_PATH = path.join(DATA_DIR, "repos.json");
const OWNER = "TheWizardNexus";
const NPM_MAINTAINER = "thewizardnexus";
const USER_AGENT = "TheWizardNexus-profile-telemetry/1.0";
const HISTORY_FROM = "2026-01-01";
const ASTROLABE_SOURCE_URL = "https://raw.githubusercontent.com/TheWizardNexus/Astrolabe/main/index.html";
const PERIODS = [
  { key: "week", endpoint: "last-week", label: "Weekly" },
  { key: "month", endpoint: "last-month", label: "Monthly" },
  { key: "year", endpoint: "last-year", label: "Yearly" },
];

const curatedHomepages = new Map([
  ["Astrolabe", "https://thewizardnexus.github.io/Astrolabe/"],
  ["arcane-os-sdk", "https://thewizardnexus.github.io/arcane-os-sdk/"],
  ["DBOPFS", "https://thewizardnexus.github.io/DBOPFS/"],
  ["DBOPFS-Studio", "https://thewizardnexus.github.io/DBOPFS-Studio/"],
  ["TheWizardNexus", "https://thewizardnexus.github.io/TheWizardNexus/"],
]);

const curatedDescriptions = new Map([
  ["Astrolabe", "An interactive map that makes the TWiN ecosystem understandable and navigable across systems, programs, people, evidence, and hosts."],
  ["arcane-os-sdk", "A standalone SDK and CLI for building, testing, packaging, and managing Arcane applications inside or outside ARCANE OS."],
  ["DBOPFS", "A browser-native, source-available database that maps tables and records to the Origin Private File System."],
  ["DBOPFS-Studio", "A Chromium workspace for exploring, editing, previewing, printing, and managing DBOPFS application data stored in OPFS."],
  ["TheWizardNexus", "The public profile, ecosystem directory, verified telemetry, and project atlas for The Wizard Nexus."],
]);

const curatedLicenses = new Map([
  ["DBOPFS", "PolyForm-Noncommercial-1.0.0"],
  ["DBOPFS-Studio", "PolyForm-Noncommercial-1.0.0"],
]);

const force = process.argv.includes("--force");
const staleHoursArgument = process.argv.find((argument) => argument.startsWith("--max-age-hours="));
const maxAgeHours = staleHoursArgument ? Number(staleHoursArgument.split("=")[1]) : 0;

if (!force && maxAgeHours > 0) {
  try {
    const existing = JSON.parse(await readFile(SNAPSHOT_PATH, "utf8"));
    const age = Date.now() - Date.parse(existing.generatedAt);
    if (Number.isFinite(age) && age < maxAgeHours * 60 * 60 * 1000) {
      console.log(`Telemetry is fresh (${Math.round(age / 60000)} minutes old); no update needed.`);
      process.exit(0);
    }
  } catch {
    // Missing or invalid snapshots are regenerated below.
  }
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function yesterdayUtc() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 1);
  return isoDate(date);
}

function earlierDate(left, right) {
  return left < right ? left : right;
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && isoDate(new Date(`${value}T00:00:00Z`)) === value;
}

function calendarDates(from, through) {
  if (!from || !through || from > through) return [];
  const dates = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${through}T00:00:00Z`);
  while (cursor <= end) {
    dates.push(isoDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function rangeChunks(from, through, maximumDays = 365) {
  const chunks = [];
  let cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${through}T00:00:00Z`);
  while (cursor <= end) {
    const chunkStart = isoDate(cursor);
    const chunkEnd = new Date(cursor);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + maximumDays - 1);
    if (chunkEnd > end) chunkEnd.setTime(end.getTime());
    chunks.push([chunkStart, isoDate(chunkEnd)]);
    cursor = new Date(chunkEnd);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return chunks;
}

async function fetchJson(url, options = {}, attempts = 4) {
  const { timeoutMs = 15_000, ...fetchOptions } = options;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...fetchOptions,
        signal: fetchOptions.signal || AbortSignal.timeout(timeoutMs),
        headers: {
          Accept: "application/json",
          "User-Agent": USER_AGENT,
          ...fetchOptions.headers,
        },
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 600 * (2 ** (attempt - 1))));
    }
  }
  throw new Error(`Unable to fetch ${url}: ${lastError?.message || lastError}`);
}

async function fetchText(url, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(15_000),
        headers: { "User-Agent": USER_AGENT },
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 600 * (2 ** (attempt - 1))));
    }
  }
  throw new Error(`Unable to fetch ${url}: ${lastError?.message || lastError}`);
}

function normalizeRepositoryUrl(value) {
  const raw = typeof value === "string" ? value : value?.url;
  if (!raw) return null;
  const normalized = raw
    .replace(/^git\+/, "")
    .replace(/^git:\/\/github\.com\//, "https://github.com/")
    .replace(/^github:/, "https://github.com/")
    .replace(/\.git(#.*)?$/, "")
    .replace(/^ssh:\/\/git@github\.com\//, "https://github.com/");
  return normalized.startsWith("git@github.com:")
    ? normalized.replace("git@github.com:", "https://github.com/")
    : normalized;
}

function packageLinks(pkg) {
  return {
    npm: pkg.links?.npm || `https://www.npmjs.com/package/${encodeURIComponent(pkg.name)}`,
    repository: normalizeRepositoryUrl(pkg.links?.repository),
    homepage: pkg.links?.homepage || null,
  };
}

function repositoryExplanation(repo) {
  if (curatedDescriptions.has(repo.name)) return curatedDescriptions.get(repo.name);
  if (repo.description?.trim()) return repo.description.trim();
  if (repo.fork) return "A TWiN fork retained for reference, experiments, or upstream contribution work.";
  const language = repo.language ? `${repo.language} ` : "";
  const title = repo.name.replace(/[._-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  return `${title} is a public ${language}project in the TWiN ecosystem; its repository does not yet publish a one-line summary.`;
}

function compactNumber(value) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function fullNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function longDate(value) {
  return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function replaceElementText(html, id, value) {
  const pattern = new RegExp(`(<[^>]+\\bid="${id}"[^>]*>)[^<]*(</[^>]+>)`, "i");
  if (!pattern.test(html)) throw new Error(`Static fallback element #${id} is missing or contains nested markup.`);
  return html.replace(pattern, `$1${escapeXml(value)}$2`);
}

function createSignalSvg({ projects, repoSnapshot, npmSnapshot, historySnapshot }) {
  const refreshed = new Date(repoSnapshot.generatedAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const metrics = [
    ["PROJECT SITES", projects.published.length, "published sites and guides"],
    ["MAPPED POINTS", projects.mapSnapshot.points, `${projects.mapSnapshot.relationships} recorded relationships`],
    ["PUBLIC REPOSITORIES", repoSnapshot.counts.total, `${repoSnapshot.counts.stars} stars received`],
    ["NPM MODULES", npmSnapshot.packageCount, `${fullNumber(historySnapshot.total)} official-range downloads`],
  ];
  const cards = metrics.map(([label, value, detail], index) => {
    const x = 48 + (index * 226);
    return `<g transform="translate(${x} 202)">
      <rect width="206" height="154" rx="18" fill="#0a1a2a" stroke="#23415a"/>
      <text x="18" y="34" class="label">${escapeXml(label)}</text>
      <text x="18" y="88" class="metric">${escapeXml(compactNumber(value))}</text>
      <text x="18" y="119" class="detail">${escapeXml(detail)}</text>
    </g>`;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="980" height="510" viewBox="0 0 980 510" role="img" aria-labelledby="title description">
  <title id="title">The Wizard Nexus public ecosystem signal</title>
  <desc id="description">${projects.published.length} published project sites, ${projects.mapSnapshot.points} mapped points, ${projects.mapSnapshot.relationships} relationships, ${repoSnapshot.counts.total} public repositories, and ${historySnapshot.total} official npm range downloads.</desc>
  <defs>
    <linearGradient id="surface" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#10263a"/><stop offset="1" stop-color="#07111d"/></linearGradient>
    <linearGradient id="signal" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#83d6a2"/><stop offset=".52" stop-color="#55d7df"/><stop offset="1" stop-color="#aa91ff"/></linearGradient>
    <radialGradient id="glow"><stop stop-color="#55d7df" stop-opacity=".22"/><stop offset="1" stop-color="#55d7df" stop-opacity="0"/></radialGradient>
  </defs>
  <style>
    text { font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; fill: #f5f8fb; }
    .eyebrow { font: 800 12px ui-monospace, SFMono-Regular, Consolas, monospace; letter-spacing: 2px; fill: #55d7df; }
    .heading { font-size: 38px; font-weight: 800; letter-spacing: -1.6px; }
    .subhead { font-size: 15px; fill: #a8b7c7; }
    .label { font: 800 10px ui-monospace, SFMono-Regular, Consolas, monospace; letter-spacing: 1.2px; fill: #71859a; }
    .metric { font-size: 42px; font-weight: 820; letter-spacing: -2px; }
    .detail { font-size: 11px; fill: #a8b7c7; }
    .foot { font: 650 11px ui-monospace, SFMono-Regular, Consolas, monospace; fill: #71859a; }
  </style>
  <rect x="1" y="1" width="978" height="508" rx="26" fill="url(#surface)" stroke="#23415a"/>
  <rect x="1" y="1" width="978" height="4" rx="2" fill="url(#signal)"/>
  <circle cx="876" cy="112" r="92" fill="url(#glow)"/>
  <circle cx="876" cy="112" r="48" fill="none" stroke="#55d7df" stroke-opacity=".32"/>
  <circle cx="876" cy="112" r="25" fill="none" stroke="#e8c576" stroke-opacity=".4" stroke-dasharray="3 5"/>
  <path d="M876 58V166M822 112H930" stroke="#b6d0e6" stroke-opacity=".14"/>
  <path d="M876 76l6 29-6 7-6-7z" fill="#55d7df"/><path d="M876 148l-6-29 6-7 6 7z" fill="#e8c576"/>
  <text x="48" y="56" class="eyebrow">TWiN PUBLIC ECOSYSTEM · VERIFIED PROFILE</text>
  <text x="48" y="108" class="heading">See the signal. Keep the human.</text>
  <text x="48" y="143" class="subhead">Governed AI, local-first infrastructure, behavioral-health intelligence, and accountable human judgment.</text>
  ${cards}
  <path d="M48 406H932" stroke="#23415a"/>
  <text x="48" y="441" class="eyebrow">OPERATING PRACTICE</text>
  <text x="48" y="470" class="subhead">OPTIMIZE  →  DETECT  →  PREVENT  →  INTERVENE</text>
  <text x="932" y="470" text-anchor="end" class="foot">refreshed ${escapeXml(refreshed)} UTC</text>
</svg>`;
}

await mkdir(DATA_DIR, { recursive: true });
await mkdir(ASSET_DIR, { recursive: true });

const generatedAt = new Date().toISOString();
const searchUrl = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(`maintainer:${NPM_MAINTAINER}`)}&size=250`;
const search = await fetchJson(searchUrl);
const registryPackages = search.objects
  .map(({ package: pkg }) => pkg)
  .filter((pkg) => pkg.maintainers?.some((maintainer) => maintainer.username?.toLowerCase() === NPM_MAINTAINER));
const packageNames = [...new Set(registryPackages.map((pkg) => pkg.name))].sort((left, right) => left.localeCompare(right));
if (!packageNames.length) throw new Error(`The NPM registry returned no packages maintained by ${NPM_MAINTAINER}.`);

const periodResponses = {};
const periodOfficialUrls = [];
for (const period of PERIODS) {
  periodResponses[period.key] = {};
  for (const name of packageNames) {
    const officialUrl = `https://api.npmjs.org/downloads/range/${period.endpoint}/${encodeURIComponent(name)}`;
    periodOfficialUrls.push(officialUrl);
    periodResponses[period.key][name] = summarizeOfficialRange(
      await fetchJson(officialUrl),
      `official npm ${period.key} range for ${name}`,
    );
  }
  const sample = periodResponses[period.key][packageNames[0]];
  if (!packageNames.every((name) => {
    const range = periodResponses[period.key][name];
    return range.start === sample.start && range.end === sample.end;
  })) {
    throw new Error(`Official npm ${period.key} ranges do not share the same coverage window.`);
  }
}

const npmPackages = registryPackages.map((pkg) => ({
  name: pkg.name,
  version: pkg.version,
  description: pkg.description || "No registry description is currently published.",
  keywords: Array.isArray(pkg.keywords) ? pkg.keywords.slice(0, 12) : [],
  publisher: pkg.publisher?.username || null,
  maintainers: (pkg.maintainers || []).map((maintainer) => maintainer.username),
  license: pkg.license || null,
  publishedAt: pkg.date || null,
  links: packageLinks(pkg),
  downloads: Object.fromEntries(PERIODS.map(({ key }) => [key, periodResponses[key][pkg.name].total])),
  series: Object.fromEntries(PERIODS.map(({ key }) => [key, periodResponses[key][pkg.name].downloads])),
})).sort((left, right) => right.downloads.year - left.downloads.year || left.name.localeCompare(right.name));

const npmSnapshot = {
  schemaVersion: 2,
  generatedAt,
  maintainer: NPM_MAINTAINER,
  source: {
    registry: searchUrl,
    authority: "Official npm download-count range API; sole authority for every published count.",
    downloads: "https://api.npmjs.org/downloads/range/{period}/{package}",
    officialUrls: periodOfficialUrls,
    semantics: "Successful package-tarball downloads, not unique people or verified installations.",
  },
  packageCount: npmPackages.length,
  periods: Object.fromEntries(PERIODS.map(({ key, label }) => {
    const sample = periodResponses[key][packageNames[0]];
    return [key, { label, start: sample?.start || null, end: sample?.end || null }];
  })),
  totals: Object.fromEntries(PERIODS.map(({ key }) => [key, npmPackages.reduce((sum, pkg) => sum + pkg.downloads[key], 0)])),
  packages: npmPackages,
};

const availabilityUrls = [];
const latestAvailableDays = [];
for (const name of packageNames) {
  const availabilityUrl = `https://api.npmjs.org/downloads/range/last-day/${encodeURIComponent(name)}`;
  availabilityUrls.push(availabilityUrl);
  const availability = summarizeOfficialRange(
    await fetchJson(availabilityUrl),
    `official npm latest available range for ${name}`,
  );
  if (!validDate(availability.end)) throw new Error(`NPM did not return a valid latest available day for ${name}.`);
  latestAvailableDays.push(availability.end);
}
const requestedUntil = yesterdayUtc();
const availableUntil = latestAvailableDays.reduce((earliest, date) => earlierDate(earliest, date), requestedUntil);
if (availableUntil < HISTORY_FROM) throw new Error(`The latest NPM day predates the requested history start ${HISTORY_FROM}.`);
const historyDates = calendarDates(HISTORY_FROM, availableUntil);
const referenceUrl = `https://npm-stat.com/api/download-counts?author=${NPM_MAINTAINER}&from=${HISTORY_FROM}&until=${availableUntil}`;
const referenceView = `https://npm-stat.com/charts.html?author=${NPM_MAINTAINER}&from=${HISTORY_FROM}&to=${requestedUntil}`;
let reference = null;
try {
  reference = await fetchJson(referenceUrl, { timeoutMs: 8_000 }, 2);
} catch (error) {
  console.warn(`Optional npm-stat comparison is unavailable; official telemetry will continue unchanged. ${error.message}`);
}
const referenceAvailable = reference !== null;
const officialUrls = [];
const officialPoints = new Map(packageNames.map((name) => [name, new Map()]));
for (const [chunkStart, chunkEnd] of rangeChunks(HISTORY_FROM, availableUntil)) {
  for (const name of packageNames) {
    const officialUrl = `https://api.npmjs.org/downloads/range/${chunkStart}:${chunkEnd}/${encodeURIComponent(name)}`;
    officialUrls.push(officialUrl);
    const chunk = summarizeOfficialRange(
      await fetchJson(officialUrl),
      `official npm history range for ${name} ${chunkStart}:${chunkEnd}`,
    );
    for (const point of chunk.downloads) {
      officialPoints.get(name).set(point.day, point.downloads);
    }
  }
}

const historyPackages = packageNames.map((name) => {
  const officialMap = officialPoints.get(name);
  const downloads = historyDates.map((date) => {
    if (!officialMap.has(date)) throw new Error(`Official NPM history is missing ${name} on ${date}.`);
    return officialMap.get(date);
  });
  return { name, total: downloads.reduce((sum, value) => sum + value, 0), downloads };
});
const overall = historyDates.map((_, index) => historyPackages.reduce((sum, pkg) => sum + pkg.downloads[index], 0));
const historyTotal = overall.reduce((sum, value) => sum + value, 0);
let referenceTotal = null;
let referenceMissingPointCount = null;
let correctedPointCount = null;
let usableReference = referenceAvailable;
if (usableReference) {
  try {
    const comparisons = historyPackages.map((pkg) => compareReferenceSeries({
      officialDownloads: historyDates.map((day, index) => ({ day, downloads: pkg.downloads[index] })),
      referencePoints: reference[pkg.name] || {},
    }));
    if (comparisons.some((comparison) => !comparison.referenceAvailable)) {
      throw new Error("The optional npm-stat comparison contains invalid values.");
    }
    referenceTotal = comparisons.reduce((sum, comparison) => sum + comparison.npmStatReferenceTotal, 0);
    referenceMissingPointCount = comparisons.reduce((sum, comparison) => sum + comparison.referenceMissingPointCount, 0);
    correctedPointCount = comparisons.reduce((sum, comparison) => sum + comparison.correctedPointCount, 0);
  } catch (error) {
    usableReference = false;
    console.warn(`NPM comparison data is invalid and will be ignored; official telemetry is unchanged. ${error.message}`);
  }
}
const firstIndex = overall.findIndex((value) => value > 0);
const peakValue = Math.max(...overall, 0);
const peakIndex = peakValue ? overall.indexOf(peakValue) : -1;
const referenceQuality = classifyReferenceQuality({
  referenceAvailable: usableReference,
  officialTotal: historyTotal,
  referenceTotal,
  correctedPointCount,
  referenceMissingPointCount,
});
const historySnapshot = {
  schemaVersion: 2,
  generatedAt,
  maintainer: NPM_MAINTAINER,
  source: {
    referenceProvider: "npm-stat.com",
    referenceUrl,
    referenceView,
    referenceRole: "Optional, non-authoritative comparison only; never used to set or adjust published counts.",
    authority: "Official npm download-count range API; sole authority for every published daily value and total.",
    authorityDocumentation: "https://github.com/npm/registry/blob/main/docs/download-counts.md",
    availabilityUrls,
    officialUrls,
    semantics: "Successful package-tarball downloads, not unique people or verified installations.",
    freshness: "The available-until date follows npm's official range/last-day endpoint, capped at the completed UTC day.",
  },
  period: {
    requestedFrom: HISTORY_FROM,
    requestedUntil,
    availableFrom: HISTORY_FROM,
    availableUntil,
  },
  packageCount: historyPackages.length,
  dates: historyDates,
  overall,
  total: historyTotal,
  dataQuality: {
    officialTotal: historyTotal,
    npmStatReferenceTotal: referenceTotal,
    officialMinusNpmStat: referenceQuality.officialMinusReference,
    publishedTotalSource: "official npm range series",
    correctedPointCount,
    referenceMissingPointCount,
    referenceAvailable: usableReference,
    exactMatch: referenceQuality.exactMatch,
    status: referenceQuality.status,
  },
  firstRecordedDay: firstIndex >= 0 ? { date: historyDates[firstIndex], downloads: overall[firstIndex] } : null,
  peakDay: peakIndex >= 0 ? { date: historyDates[peakIndex], downloads: peakValue } : null,
  packages: historyPackages,
};

const githubToken = process.env.PROFILE_GITHUB_TOKEN || process.env.GITHUB_TOKEN;
const githubHeaders = githubToken ? { Authorization: `Bearer ${githubToken}`, "X-GitHub-Api-Version": "2022-11-28" } : {};
const githubProfile = await fetchJson(`https://api.github.com/users/${OWNER}`, { headers: githubHeaders });
const githubRepos = [];
for (let page = 1; ; page += 1) {
  const batch = await fetchJson(`https://api.github.com/users/${OWNER}/repos?per_page=100&page=${page}&type=owner&sort=updated`, { headers: githubHeaders });
  githubRepos.push(...batch);
  if (batch.length < 100) break;
}
const repositories = githubRepos.map((repo) => ({
  name: repo.name,
  fullName: repo.full_name,
  description: repo.description,
  explanation: repositoryExplanation(repo),
  url: repo.html_url,
  homepage: curatedHomepages.get(repo.name) || repo.homepage || null,
  language: repo.language || "Unclassified",
  stars: repo.stargazers_count,
  forks: repo.forks_count,
  openIssues: repo.open_issues_count,
  watchers: repo.watchers_count,
  archived: repo.archived,
  disabled: repo.disabled,
  fork: repo.fork,
  topics: Array.isArray(repo.topics) ? repo.topics : [],
  license: curatedLicenses.get(repo.name) || (repo.license?.spdx_id === "NOASSERTION" ? null : repo.license?.spdx_id) || null,
  createdAt: repo.created_at,
  updatedAt: repo.updated_at,
}));
const repoSnapshot = {
  schemaVersion: 1,
  generatedAt,
  source: {
    profile: `https://api.github.com/users/${OWNER}`,
    repositories: `https://api.github.com/users/${OWNER}/repos?per_page=100&type=owner`,
  },
  owner: {
    login: githubProfile.login,
    name: githubProfile.name,
    bio: githubProfile.bio,
    avatar: githubProfile.avatar_url,
    url: githubProfile.html_url,
    followers: githubProfile.followers,
    following: githubProfile.following,
  },
  counts: {
    total: repositories.length,
    original: repositories.filter((repo) => !repo.fork).length,
    forks: repositories.filter((repo) => repo.fork).length,
    archived: repositories.filter((repo) => repo.archived).length,
    stars: repositories.reduce((sum, repo) => sum + repo.stars, 0),
  },
  repositories,
};

const projects = JSON.parse(await readFile(PROJECTS_PATH, "utf8"));
const astrolabeSource = await fetchText(ASTROLABE_SOURCE_URL);
const groupBlock = astrolabeSource.match(/const groups = \[([\s\S]*?)\n\s*\];/);
const mappedPoints = (astrolabeSource.match(/\bN\((?:&#x27;|')/g) || []).length;
const mappedRelationships = (astrolabeSource.match(/\bR\((?:&#x27;|')/g) || []).length;
const mappedRings = (groupBlock?.[1].match(/\{id:(?:&#x27;|')/g) || []).length;
if (!mappedPoints || !mappedRelationships || !mappedRings) throw new Error("Unable to verify the current Astrolabe map counts.");
projects.generatedAt = generatedAt;
projects.mapSnapshot = {
  source: "https://github.com/TheWizardNexus/Astrolabe",
  dataUrl: ASTROLABE_SOURCE_URL,
  points: mappedPoints,
  relationships: mappedRelationships,
  rings: mappedRings,
};
const readme = await readFile(README_PATH, "utf8");
const readmeStart = "<!-- profile-telemetry-counts:start -->";
const readmeEnd = "<!-- profile-telemetry-counts:end -->";
const readmePattern = new RegExp(`${readmeStart}[\\s\\S]*?${readmeEnd}`);
if (!readmePattern.test(readme)) throw new Error("README telemetry count markers are missing.");
const readmeSummary = `${readmeStart}
<p align="center">
  <strong>${projects.published.length} published project sites · ${projects.mapSnapshot.points} mapped ecosystem points · ${projects.mapSnapshot.relationships} relationships · ${repoSnapshot.counts.total} public repositories</strong><br>
  <sub><strong>${fullNumber(historySnapshot.total)} official npm range downloads</strong> from ${longDate(historySnapshot.period.availableFrom)} through ${longDate(historySnapshot.period.availableUntil)} · npm-stat is an optional comparison only</sub><br>
  <a href="https://thewizardnexus.github.io/TheWizardNexus/"><strong>Navigate the live TWiN ecosystem atlas →</strong></a>
</p>
${readmeEnd}`;
const updatedReadme = readme.replace(readmePattern, readmeSummary);
const latestRepositoryUpdate = repositories
  .map((repo) => repo.updatedAt)
  .filter(Boolean)
  .sort()
  .at(-1);
const sharedFallbacks = {
  "project-total": projects.published.length,
  "mapped-points": projects.mapSnapshot.points,
  "mapped-relationships": projects.mapSnapshot.relationships,
  "next-total": projects.publishingNext.length,
  "repo-total-hero": repoSnapshot.counts.total,
  "repo-total": repoSnapshot.counts.total,
  "repo-original": repoSnapshot.counts.original,
  "repo-stars": repoSnapshot.counts.stars,
  "repo-updated": latestRepositoryUpdate
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(latestRepositoryUpdate))
    : "—",
  "project-result-count": `${projects.published.length} published project sites in the public constellation.`,
  "repo-result-count": `${repoSnapshot.counts.total} public repositories in the atlas.`,
  "npm-history-total": fullNumber(historySnapshot.total),
  "npm-week": fullNumber(npmSnapshot.totals.week),
  "npm-month": fullNumber(npmSnapshot.totals.month),
  "npm-year": fullNumber(npmSnapshot.totals.year),
  "npm-chart-period": `${longDate(historySnapshot.period.availableFrom)}–${longDate(historySnapshot.period.availableUntil)} · official daily range series`,
  "npm-first-day": historySnapshot.firstRecordedDay
    ? `${longDate(historySnapshot.firstRecordedDay.date)} · ${fullNumber(historySnapshot.firstRecordedDay.downloads)}`
    : "No recorded downloads",
  "npm-peak-day": historySnapshot.peakDay
    ? `${longDate(historySnapshot.peakDay.date)} · ${fullNumber(historySnapshot.peakDay.downloads)}`
    : "No recorded downloads",
  "npm-coverage": `${fullNumber(historySnapshot.dates.length)} official range days · ${fullNumber(historySnapshot.packageCount)} ${historySnapshot.packageCount === 1 ? "module" : "modules"}`,
  "npm-status": historySnapshot.dataQuality.referenceAvailable
    ? historySnapshot.dataQuality.exactMatch
      ? "Official npm range series is authoritative; optional npm-stat comparison matches point for point."
      : "Official npm range series is authoritative and published unchanged; optional npm-stat comparison differs."
    : "Official npm range series is authoritative; optional npm-stat comparison is unavailable.",
};

const pageFallbacks = new Map([
  [path.join(ROOT, "index.html"), ["project-total", "mapped-points", "mapped-relationships", "repo-total-hero"]],
  [path.join(ROOT, "ecosystem.html"), ["project-total", "mapped-points", "mapped-relationships", "next-total", "project-result-count"]],
  [path.join(ROOT, "code.html"), ["repo-total", "repo-original", "repo-stars", "repo-updated", "repo-result-count"]],
  [path.join(ROOT, "signal.html"), [
    "project-total",
    "mapped-points",
    "mapped-relationships",
    "repo-total",
    "npm-history-total",
    "npm-week",
    "npm-month",
    "npm-year",
    "npm-chart-period",
    "npm-first-day",
    "npm-peak-day",
    "npm-coverage",
    "npm-status",
  ]],
]);
const updatedPages = [];
for (const [pagePath, fallbackIds] of pageFallbacks) {
  let html = await readFile(pagePath, "utf8");
  for (const id of fallbackIds) html = replaceElementText(html, id, sharedFallbacks[id]);
  updatedPages.push([pagePath, html]);
}

await Promise.all([
  writeFile(path.join(DATA_DIR, "npm-stats.json"), `${JSON.stringify(npmSnapshot, null, 2)}\n`, "utf8"),
  writeFile(path.join(DATA_DIR, "npm-history.json"), `${JSON.stringify(historySnapshot, null, 2)}\n`, "utf8"),
  writeFile(SNAPSHOT_PATH, `${JSON.stringify(repoSnapshot, null, 2)}\n`, "utf8"),
  writeFile(PROJECTS_PATH, `${JSON.stringify(projects, null, 2)}\n`, "utf8"),
  writeFile(path.join(ASSET_DIR, "twin-signal.svg"), `${createSignalSvg({ projects, repoSnapshot, npmSnapshot, historySnapshot })}\n`, "utf8"),
  writeFile(README_PATH, updatedReadme, "utf8"),
  ...updatedPages.map(([pagePath, html]) => writeFile(pagePath, html, "utf8")),
]);

const snapshotStats = await stat(SNAPSHOT_PATH);
console.log(`Recorded ${repoSnapshot.counts.total} public repositories and ${npmSnapshot.packageCount} NPM module through ${historySnapshot.period.availableUntil}.`);
console.log(usableReference
  ? `Official NPM total: ${fullNumber(historySnapshot.total)}; optional npm-stat comparison: ${fullNumber(historySnapshot.dataQuality.npmStatReferenceTotal)}.`
  : `Official NPM total: ${fullNumber(historySnapshot.total)}; optional npm-stat comparison unavailable.`);
console.log(`Updated snapshots at ${snapshotStats.mtime.toISOString()}.`);
