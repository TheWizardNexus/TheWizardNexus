const numberFormatter = new Intl.NumberFormat("en-US");
const compactFormatter = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const shortDateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const monthDayFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const monthFormatter = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const state = {
  projects: null,
  projectFilter: "all",
  projectQuery: "",
  projectsExpanded: false,
  repos: null,
  repoKind: "all",
  repoLanguage: "all",
  repoQuery: "",
  repoSort: "updated",
  npm: null,
  npmHistory: null,
  chart: null,
  chartHoverIndex: null,
  loadStatus: { projects: "loading", repos: "loading", npm: "loading" },
};

const elements = {
  menuButton: document.querySelector(".menu-button"),
  navigation: document.querySelector("#primary-navigation"),
  freshness: document.querySelector("#freshness"),
  projectTotal: document.querySelector("#project-total"),
  mappedPoints: document.querySelector("#mapped-points"),
  mappedRelationships: document.querySelector("#mapped-relationships"),
  nextTotal: document.querySelector("#next-total"),
  projectSearch: document.querySelector("#project-search"),
  projectFilters: document.querySelector("#project-filters"),
  projectGrid: document.querySelector("#project-grid"),
  projectResultCount: document.querySelector("#project-result-count"),
  projectLoadMore: document.querySelector("#project-load-more"),
  launchList: document.querySelector("#launch-list"),
  repoTotalHero: document.querySelector("#repo-total-hero"),
  repoTotal: document.querySelector("#repo-total"),
  repoOriginal: document.querySelector("#repo-original"),
  repoStars: document.querySelector("#repo-stars"),
  repoUpdated: document.querySelector("#repo-updated"),
  repoSearch: document.querySelector("#repo-search"),
  repoLanguage: document.querySelector("#repo-language"),
  repoSort: document.querySelector("#repo-sort"),
  repoFilters: document.querySelector("#repo-filters"),
  repoResultCount: document.querySelector("#repo-result-count"),
  repoGrid: document.querySelector("#repo-grid"),
  npmHistoryTotal: document.querySelector("#npm-history-total"),
  npmChartKicker: document.querySelector("#npm-chart-kicker"),
  npmWeek: document.querySelector("#npm-week"),
  npmMonth: document.querySelector("#npm-month"),
  npmYear: document.querySelector("#npm-year"),
  npmChartPeriod: document.querySelector("#npm-chart-period"),
  npmFirstDay: document.querySelector("#npm-first-day"),
  npmPeakDay: document.querySelector("#npm-peak-day"),
  npmCoverage: document.querySelector("#npm-coverage"),
  npmStatus: document.querySelector("#npm-status"),
  npmDailyCaption: document.querySelector("#npm-daily-caption"),
  npmDailyBody: document.querySelector("#npm-daily-body"),
  packageList: document.querySelector("#package-list"),
  chartFrame: document.querySelector("#chart-frame"),
  chartCanvas: document.querySelector("#npm-chart"),
  chartTooltip: document.querySelector("#chart-tooltip"),
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  return value ? shortDateFormatter.format(new Date(`${value}T00:00:00Z`)) : "date unavailable";
}

function formatMonthDay(value) {
  return value ? monthDayFormatter.format(new Date(`${value}T00:00:00Z`)) : "date unavailable";
}

function formatTimestamp(value) {
  if (!value) return "time unavailable";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(value));
}

async function fetchJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${path}`);
  return response.json();
}

const projectGroups = {
  foundation: new Set(["arcane-os", "astrolabe", "dbopfs", "spellwire", "toshokann", "twin-compass"]),
  platform: new Set(["arcane-os", "arcane-os-sdk", "ax", "dbopfs", "dbopfs-studio"]),
  safety: new Set(["twin-compass", "kempo", "sentinel", "scamurai", "redress"]),
};

function projectMatchesFilter(project) {
  return state.projectFilter === "all" || projectGroups[state.projectFilter]?.has(project.slug);
}

function renderProjects() {
  if (!state.projects) return;
  const query = state.projectQuery.trim().toLowerCase();
  const filtered = state.projects.published.filter((project) => {
    const haystack = [project.name, project.category, project.description, project.sourceStatus].join(" ").toLowerCase();
    return projectMatchesFilter(project) && (!query || haystack.includes(query));
  });
  const shouldLimit = state.projectFilter === "all" && !query && !state.projectsExpanded;
  const visible = shouldLimit ? filtered.slice(0, 9) : filtered;

  elements.projectResultCount.textContent = `${numberFormatter.format(filtered.length)} published ${filtered.length === 1 ? "project" : "projects"}${query || state.projectFilter !== "all" ? " match this view" : " in the public constellation"}.`;
  elements.projectLoadMore.hidden = !shouldLimit || filtered.length <= visible.length;
  elements.projectLoadMore.textContent = `Reveal ${filtered.length - visible.length} more projects`;

  if (!visible.length) {
    elements.projectGrid.innerHTML = '<p class="result-count">No published project matches that search.</p>';
    return;
  }

  elements.projectGrid.innerHTML = visible.map((project) => {
    const repository = project.repositoryUrl
      ? `<a class="secondary" href="${escapeHtml(project.repositoryUrl)}">Inspect repository ↗</a>`
      : "";
    return `<article class="project-card" data-accent="${escapeHtml(project.accent)}">
      <a class="project-media" href="${escapeHtml(project.url)}" aria-label="Open ${escapeHtml(project.name)}">
        <img src="${escapeHtml(project.image)}" alt="" loading="lazy">
        <span class="image-fallback">${escapeHtml(project.name)}</span>
      </a>
      <div class="project-body">
        <div class="card-kicker"><span>${escapeHtml(project.category)}</span><span>${escapeHtml(project.sourceStatus)}</span></div>
        <h3>${escapeHtml(project.name)}</h3>
        <p>${escapeHtml(project.description)}</p>
        <div class="card-links"><a href="${escapeHtml(project.url)}">Explore project ↗</a>${repository}</div>
      </div>
    </article>`;
  }).join("");

  for (const image of elements.projectGrid.querySelectorAll("img")) {
    image.addEventListener("error", () => image.closest(".project-media")?.classList.add("image-error"), { once: true });
  }
}

function renderLaunchQueue() {
  const next = state.projects?.publishingNext || [];
  elements.launchList.innerHTML = next.map((project) => `<article class="launch-item"><strong>${escapeHtml(project.name)}</strong><span>${escapeHtml(project.description)}</span></article>`).join("");
  if (elements.nextTotal) elements.nextTotal.textContent = numberFormatter.format(next.length);
}

function renderProjectSummary() {
  if (!state.projects) return;
  elements.projectTotal.textContent = numberFormatter.format(state.projects.published.length);
  elements.mappedPoints.textContent = numberFormatter.format(state.projects.mapSnapshot.points);
  elements.mappedRelationships.textContent = numberFormatter.format(state.projects.mapSnapshot.relationships);
  renderLaunchQueue();
  renderProjects();
}

function sortedRepositories(repositories) {
  return [...repositories].sort((left, right) => {
    if (state.repoSort === "stars") return right.stars - left.stars || left.name.localeCompare(right.name);
    if (state.repoSort === "name") return left.name.localeCompare(right.name);
    return new Date(right.updatedAt) - new Date(left.updatedAt);
  });
}

function repoMatchesKind(repo) {
  if (state.repoKind === "fork") return repo.fork;
  if (state.repoKind === "original") return !repo.fork;
  if (state.repoKind === "archived") return repo.archived;
  return true;
}

function renderRepositories() {
  if (!state.repos) return;
  const query = state.repoQuery.trim().toLowerCase();
  const filtered = sortedRepositories(state.repos.repositories.filter((repo) => {
    const haystack = [repo.name, repo.description, repo.explanation, repo.language, ...(repo.topics || [])].join(" ").toLowerCase();
    return repoMatchesKind(repo)
      && (state.repoLanguage === "all" || repo.language === state.repoLanguage)
      && (!query || haystack.includes(query));
  }));

  elements.repoResultCount.textContent = `${numberFormatter.format(filtered.length)} of ${numberFormatter.format(state.repos.counts.total)} public ${filtered.length === 1 ? "repository" : "repositories"} shown.`;
  if (!filtered.length) {
    elements.repoGrid.innerHTML = '<p class="result-count">No public repository matches these filters.</p>';
    return;
  }

  elements.repoGrid.innerHTML = filtered.map((repo) => {
    const homepage = repo.homepage ? `<a href="${escapeHtml(repo.homepage)}">Open live site ↗</a>` : "";
    const flags = [repo.fork ? "Fork" : "Original", repo.archived ? "Archived" : null].filter(Boolean).join(" · ");
    return `<article class="repo-card">
      <div class="card-kicker"><span>${escapeHtml(flags)}</span><span>Updated ${escapeHtml(formatDate(repo.updatedAt.slice(0, 10)))}</span></div>
      <h3>${escapeHtml(repo.name)}</h3>
      <p>${escapeHtml(repo.explanation)}</p>
      <div class="repo-meta"><span class="language">${escapeHtml(repo.language)}</span><span>★ ${numberFormatter.format(repo.stars)}</span><span>⑂ ${numberFormatter.format(repo.forks)}</span><span>${escapeHtml(repo.license || "License not declared")}</span></div>
      <div class="repo-links"><a href="${escapeHtml(repo.url)}">Inspect code ↗</a>${homepage}</div>
    </article>`;
  }).join("");
}

function renderRepositorySummary() {
  if (!state.repos) return;
  const { counts, repositories } = state.repos;
  elements.repoTotalHero.textContent = numberFormatter.format(counts.total);
  elements.repoTotal.textContent = numberFormatter.format(counts.total);
  elements.repoOriginal.textContent = numberFormatter.format(counts.original);
  elements.repoStars.textContent = numberFormatter.format(counts.stars);
  const latest = [...repositories].sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt))[0];
  elements.repoUpdated.textContent = latest ? formatMonthDay(latest.updatedAt.slice(0, 10)) : "—";
  const languages = [...new Set(repositories.map((repo) => repo.language).filter(Boolean))].sort();
  elements.repoLanguage.innerHTML = '<option value="all">All languages</option>' + languages.map((language) => `<option value="${escapeHtml(language)}">${escapeHtml(language)}</option>`).join("");
  renderRepositories();
}

function drawChart() {
  if (!state.chart?.points.length) return;
  const { points } = state.chart;
  const canvas = elements.chartCanvas;
  const width = Math.max(elements.chartFrame.clientWidth, 300);
  const height = Math.max(elements.chartFrame.clientHeight, 260);
  const density = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * density);
  canvas.height = Math.round(height * density);
  const context = canvas.getContext("2d");
  context.scale(density, density);

  const padding = { top: 24, right: 22, bottom: 38, left: width < 500 ? 42 : 58 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maximum = Math.max(...points.map((point) => point.value), 0);
  const ceiling = maximum > 0 ? maximum * 1.08 : 1;
  const xFor = (index) => padding.left + ((points.length === 1 ? 0.5 : index / (points.length - 1)) * plotWidth);
  const yFor = (value) => padding.top + plotHeight - ((value / ceiling) * plotHeight);

  context.clearRect(0, 0, width, height);
  context.font = "650 10px ui-monospace, SFMono-Regular, Consolas, monospace";
  context.textAlign = "right";
  context.textBaseline = "middle";
  context.fillStyle = "#71859a";
  for (let tick = 0; tick <= 4; tick += 1) {
    const ratio = tick / 4;
    const y = padding.top + plotHeight * ratio;
    context.strokeStyle = "rgba(182,208,230,0.1)";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right, y);
    context.stroke();
    context.fillText(compactFormatter.format(Math.round(ceiling * (1 - ratio))), padding.left - 8, y);
  }

  const monthIndexes = [];
  points.forEach((point, index) => {
    if (index === 0 || point.date.slice(5, 7) !== points[index - 1].date.slice(5, 7)) monthIndexes.push(index);
  });
  const labels = width < 500 ? monthIndexes.filter((_, index) => index % 2 === 0) : monthIndexes;
  context.textAlign = "center";
  context.textBaseline = "top";
  for (const index of labels) context.fillText(monthFormatter.format(new Date(`${points[index].date}T00:00:00Z`)), xFor(index), height - padding.bottom + 12);

  const coordinates = points.map((point, index) => ({ x: xFor(index), y: yFor(point.value) }));
  const area = context.createLinearGradient(0, padding.top, 0, height - padding.bottom);
  area.addColorStop(0, "rgba(85,215,223,0.34)");
  area.addColorStop(0.58, "rgba(84,168,255,0.11)");
  area.addColorStop(1, "rgba(84,168,255,0.01)");
  context.beginPath();
  coordinates.forEach(({ x, y }, index) => index ? context.lineTo(x, y) : context.moveTo(x, y));
  context.lineTo(coordinates.at(-1).x, height - padding.bottom);
  context.lineTo(coordinates[0].x, height - padding.bottom);
  context.closePath();
  context.fillStyle = area;
  context.fill();

  const line = context.createLinearGradient(padding.left, 0, width - padding.right, 0);
  line.addColorStop(0, "#83d6a2");
  line.addColorStop(0.55, "#55d7df");
  line.addColorStop(1, "#54a8ff");
  context.beginPath();
  coordinates.forEach(({ x, y }, index) => index ? context.lineTo(x, y) : context.moveTo(x, y));
  context.strokeStyle = line;
  context.lineWidth = 2.3;
  context.lineJoin = "round";
  context.stroke();

  const peakIndex = points.reduce((best, point, index) => point.value > points[best].value ? index : best, 0);
  const highlighted = state.chartHoverIndex ?? peakIndex;
  const point = coordinates[highlighted];
  context.strokeStyle = state.chartHoverIndex === null ? "rgba(232,197,118,0.45)" : "rgba(85,215,223,0.4)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(point.x, padding.top);
  context.lineTo(point.x, height - padding.bottom);
  context.stroke();
  context.fillStyle = state.chartHoverIndex === null ? "#e8c576" : "#55d7df";
  context.beginPath();
  context.arc(point.x, point.y, 4.3, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = "rgba(7,17,29,0.9)";
  context.lineWidth = 2;
  context.stroke();

  state.chartPlot = { width, padding, plotWidth, coordinates };
  canvas.setAttribute("aria-label", `${numberFormatter.format(points.reduce((sum, point) => sum + point.value, 0))} recorded NPM downloads from ${formatDate(points[0].date)} through ${formatDate(points.at(-1).date)}. A complete daily table follows the chart.`);
}

function updateChartTooltip(event) {
  if (!state.chart?.points.length || !state.chartPlot) return;
  const bounds = elements.chartCanvas.getBoundingClientRect();
  const localX = Math.max(state.chartPlot.padding.left, Math.min(event.clientX - bounds.left, state.chartPlot.width - state.chartPlot.padding.right));
  const ratio = (localX - state.chartPlot.padding.left) / state.chartPlot.plotWidth;
  const index = Math.max(0, Math.min(state.chart.points.length - 1, Math.round(ratio * (state.chart.points.length - 1))));
  if (state.chartHoverIndex !== index) {
    state.chartHoverIndex = index;
    drawChart();
  }
  const point = state.chart.points[index];
  const coordinate = state.chartPlot.coordinates[index];
  elements.chartTooltip.innerHTML = `<b>${escapeHtml(formatDate(point.date))}</b>${numberFormatter.format(point.value)} downloads`;
  elements.chartTooltip.hidden = false;
  elements.chartTooltip.style.left = `${Math.max(8, Math.min(coordinate.x + 10, state.chartPlot.width - 155))}px`;
  elements.chartTooltip.style.top = `${Math.max(8, coordinate.y - 26)}px`;
}

function hideChartTooltip() {
  elements.chartTooltip.hidden = true;
  state.chartHoverIndex = null;
  drawChart();
}

function renderNpm() {
  if (!state.npm || !state.npmHistory) return;
  const history = state.npmHistory;
  const fromYear = history.period.availableFrom.slice(0, 4);
  const untilYear = history.period.availableUntil.slice(0, 4);
  elements.npmChartKicker.textContent = fromYear === untilYear ? `Recorded ${fromYear} history` : `Recorded ${fromYear}–${untilYear} history`;
  elements.npmHistoryTotal.textContent = numberFormatter.format(history.total);
  elements.npmWeek.textContent = numberFormatter.format(state.npm.totals.week);
  elements.npmMonth.textContent = numberFormatter.format(state.npm.totals.month);
  elements.npmYear.textContent = numberFormatter.format(state.npm.totals.year);
  elements.npmChartPeriod.textContent = `${formatDate(history.period.availableFrom)}–${formatDate(history.period.availableUntil)} · daily verified series`;
  elements.npmFirstDay.textContent = history.firstRecordedDay ? `${formatDate(history.firstRecordedDay.date)} · ${numberFormatter.format(history.firstRecordedDay.downloads)}` : "No recorded downloads";
  elements.npmPeakDay.textContent = history.peakDay ? `${formatDate(history.peakDay.date)} · ${numberFormatter.format(history.peakDay.downloads)}` : "No recorded downloads";
  elements.npmCoverage.textContent = `${numberFormatter.format(history.dates.length)} finalized days · ${numberFormatter.format(history.packageCount)} ${history.packageCount === 1 ? "module" : "modules"}`;
  const refreshed = `refreshed ${formatTimestamp(history.generatedAt)}`;
  if (!history.dataQuality.referenceAvailable) {
    elements.npmStatus.textContent = `Official NPM daily series recorded; npm-stat cross-check temporarily unavailable · ${refreshed}`;
  } else if (history.dataQuality.exactMatch) {
    elements.npmStatus.textContent = `Official NPM daily series exactly matches the npm-stat reference point for point · ${refreshed}`;
  } else {
    const correction = history.dataQuality.correction;
    const correctionSummary = correction === 0
      ? "point-level differences net to zero"
      : `${numberFormatter.format(Math.abs(correction))} net ${correction > 0 ? "additional" : "fewer"} downloads`;
    elements.npmStatus.textContent = `Official NPM record reconciles the npm-stat reference: ${correctionSummary} · ${refreshed}`;
  }

  elements.npmDailyCaption.textContent = `Daily NPM downloads for all maintained modules from ${formatDate(history.period.availableFrom)} through ${formatDate(history.period.availableUntil)}`;
  elements.npmDailyBody.innerHTML = history.dates.map((date, index) => `<tr><th scope="row"><time datetime="${escapeHtml(date)}">${escapeHtml(formatDate(date))}</time></th><td>${numberFormatter.format(history.overall[index])}</td></tr>`).join("");

  elements.packageList.innerHTML = state.npm.packages.map((pkg) => `<article class="package-row"><div><strong>${escapeHtml(pkg.name)} · v${escapeHtml(pkg.version)}</strong><span>${escapeHtml(pkg.description)} · ${escapeHtml(pkg.license || "license not listed")} · ${numberFormatter.format(pkg.downloads.year)} rolling-year downloads</span></div><a href="${escapeHtml(pkg.links.npm)}">NPM ↗</a></article>`).join("");

  state.chart = { points: history.dates.map((date, index) => ({ date, value: history.overall[index] })) };
  drawChart();
}

function updateFreshness() {
  const timestamps = [state.projects?.generatedAt, state.repos?.generatedAt, state.npm?.generatedAt, state.npmHistory?.generatedAt].filter(Boolean).map(Date.parse);
  const statuses = Object.values(state.loadStatus);
  if (!timestamps.length) {
    if (statuses.every((status) => status !== "loading")) elements.freshness.textContent = "The live public snapshot is temporarily unavailable; the ecosystem links remain usable.";
    return;
  }
  const latest = new Date(Math.max(...timestamps));
  const label = statuses.every((status) => status === "ready") ? "Public snapshot" : "Available public data";
  elements.freshness.innerHTML = `<span aria-hidden="true"></span> ${label} verified ${escapeHtml(formatTimestamp(latest.toISOString()))}`;
}

async function loadProjects() {
  try {
    state.projects = await fetchJson("data/projects.json");
    renderProjectSummary();
    state.loadStatus.projects = "ready";
  } catch (error) {
    state.loadStatus.projects = "error";
    elements.projectResultCount.textContent = "The project directory is temporarily unavailable.";
    console.error("Unable to load the project directory.", error);
  } finally {
    updateFreshness();
  }
}

async function loadRepositories() {
  try {
    state.repos = await fetchJson("data/repos.json");
    renderRepositorySummary();
    state.loadStatus.repos = "ready";
  } catch (error) {
    state.loadStatus.repos = "error";
    elements.repoResultCount.textContent = "The public repository snapshot is temporarily unavailable.";
    console.error("Unable to load the public repository snapshot.", error);
  } finally {
    updateFreshness();
  }
}

async function loadNpm() {
  try {
    [state.npm, state.npmHistory] = await Promise.all([
      fetchJson("data/npm-stats.json"),
      fetchJson("data/npm-history.json"),
    ]);
    renderNpm();
    state.loadStatus.npm = "ready";
  } catch (error) {
    state.loadStatus.npm = "error";
    elements.npmStatus.textContent = "Verified NPM telemetry is temporarily unavailable.";
    elements.npmDailyBody.innerHTML = '<tr><td colspan="2">Daily values are temporarily unavailable.</td></tr>';
    console.error("Unable to load verified NPM telemetry.", error);
  } finally {
    updateFreshness();
  }
}

function getHashTarget() {
  if (!location.hash) return null;
  try {
    return document.getElementById(decodeURIComponent(location.hash.slice(1)));
  } catch {
    return null;
  }
}

function scheduleHashAlignment() {
  if (!location.hash) return;
  const alignHashTarget = () => getHashTarget()?.scrollIntoView({ block: "start", behavior: "instant" });
  window.requestAnimationFrame(() => window.requestAnimationFrame(alignHashTarget));
  if (document.readyState === "complete") {
    window.setTimeout(alignHashTarget, 200);
  } else {
    window.addEventListener("load", () => window.setTimeout(alignHashTarget, 200), { once: true });
  }
}

async function initialize() {
  scheduleHashAlignment();
  await Promise.allSettled([loadProjects(), loadRepositories(), loadNpm()]);
  scheduleHashAlignment();
}

elements.menuButton.addEventListener("click", () => {
  const open = elements.menuButton.getAttribute("aria-expanded") !== "true";
  elements.menuButton.setAttribute("aria-expanded", String(open));
  elements.navigation.dataset.open = String(open);
});
elements.navigation.addEventListener("click", (event) => {
  if (!event.target.closest("a")) return;
  elements.menuButton.setAttribute("aria-expanded", "false");
  elements.navigation.dataset.open = "false";
});
elements.projectSearch.addEventListener("input", (event) => {
  state.projectQuery = event.target.value;
  renderProjects();
});
elements.projectFilters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-project-filter]");
  if (!button) return;
  state.projectFilter = button.dataset.projectFilter;
  for (const candidate of elements.projectFilters.querySelectorAll("button")) candidate.setAttribute("aria-pressed", String(candidate === button));
  renderProjects();
});
elements.projectLoadMore.addEventListener("click", () => {
  state.projectsExpanded = true;
  renderProjects();
});
elements.repoSearch.addEventListener("input", (event) => {
  state.repoQuery = event.target.value;
  renderRepositories();
});
elements.repoLanguage.addEventListener("change", (event) => {
  state.repoLanguage = event.target.value;
  renderRepositories();
});
elements.repoSort.addEventListener("change", (event) => {
  state.repoSort = event.target.value;
  renderRepositories();
});
elements.repoFilters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-repo-kind]");
  if (!button) return;
  state.repoKind = button.dataset.repoKind;
  for (const candidate of elements.repoFilters.querySelectorAll("button")) candidate.setAttribute("aria-pressed", String(candidate === button));
  renderRepositories();
});
elements.chartCanvas.addEventListener("pointermove", updateChartTooltip);
elements.chartCanvas.addEventListener("pointerleave", hideChartTooltip);
elements.chartCanvas.addEventListener("pointercancel", hideChartTooltip);
window.addEventListener("resize", () => window.requestAnimationFrame(drawChart));

if (!reduceMotion) {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) if (entry.isIntersecting) entry.target.animate([
      { opacity: 0, transform: "translateY(16px)" },
      { opacity: 1, transform: "translateY(0)" },
    ], { duration: 500, easing: "cubic-bezier(.2,.7,.2,1)", fill: "both" });
  }, { threshold: 0.08 });
  for (const section of document.querySelectorAll("main > section")) observer.observe(section);
}

initialize();
