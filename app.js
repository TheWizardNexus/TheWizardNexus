document.documentElement.classList.add("js");

const numberFormatter = new Intl.NumberFormat("en-US");
const compactFormatter = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const shortDateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const monthDayFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const monthFormatter = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });
const timestampFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

const state = {
  projects: null,
  projectFilter: "all",
  projectQuery: "",
  repositories: null,
  repoKind: "all",
  repoLanguage: "all",
  repoQuery: "",
  repoSort: "updated",
  npm: null,
  npmHistory: null,
  chart: null,
  chartPlot: null,
  chartHoverIndex: null,
  requestedLoads: new Set(),
  completedLoads: new Set(),
  failedLoads: new Set(),
  timestamps: [],
};

const menuButton = document.querySelector(".menu-button");
const navigation = document.querySelector("#primary-navigation");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function formatDate(value) {
  return value ? shortDateFormatter.format(new Date(`${value}T00:00:00Z`)) : "date unavailable";
}

function formatMonthDay(value) {
  return value ? monthDayFormatter.format(new Date(`${value}T00:00:00Z`)) : "—";
}

function formatTimestamp(value) {
  return value ? timestampFormatter.format(new Date(value)) : "time unavailable";
}

async function fetchJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${path}`);
  return response.json();
}

function markCurrentPage() {
  const current = location.pathname.split("/").pop() || "index.html";
  for (const link of navigation?.querySelectorAll("a[href]") || []) {
    if (link.getAttribute("href") === current) link.setAttribute("aria-current", "page");
  }
}

function wireMenu() {
  if (!menuButton || !navigation) return;
  menuButton.addEventListener("click", () => {
    const open = menuButton.getAttribute("aria-expanded") !== "true";
    menuButton.setAttribute("aria-expanded", String(open));
    navigation.dataset.open = String(open);
  });
  navigation.addEventListener("click", (event) => {
    if (!event.target.closest("a")) return;
    menuButton.setAttribute("aria-expanded", "false");
    navigation.dataset.open = "false";
  });
}

function registerLoad(name) {
  state.requestedLoads.add(name);
}

function completeLoad(name, timestamp = null, failed = false) {
  state.completedLoads.add(name);
  if (failed) state.failedLoads.add(name);
  if (timestamp && Number.isFinite(Date.parse(timestamp))) state.timestamps.push(Date.parse(timestamp));
  updateFreshness();
}

function updateFreshness() {
  const freshness = document.querySelector("#freshness");
  if (!freshness) return;
  const allComplete = [...state.requestedLoads].every((name) => state.completedLoads.has(name));
  if (!state.timestamps.length) {
    if (allComplete) freshness.textContent = "The live snapshot is temporarily unavailable; every published route remains usable.";
    return;
  }
  const latest = new Date(Math.max(...state.timestamps));
  const label = allComplete
    ? state.failedLoads.size ? "Partial public snapshot refreshed" : "Public snapshot refreshed"
    : "Available public data refreshed";
  freshness.innerHTML = `<span aria-hidden="true"></span> ${label} ${escapeHtml(formatTimestamp(latest.toISOString()))}`;
}

const projectGroups = {
  foundation: new Set(["astrolabe", "twin-compass", "kempo", "spellwire"]),
  platform: new Set(["arcane-os", "arcane-os-sdk", "ax", "dbopfs", "dbopfs-studio", "toshokann"]),
  workspace: new Set(["sentinel", "scamurai", "redress"]),
};

function projectMatchesFilter(project) {
  return state.projectFilter === "all" || projectGroups[state.projectFilter]?.has(project.slug);
}

function projectMaturityLabel(project) {
  return [project.maturity || project.stage, project.version].filter(Boolean).join(" · ");
}

function renderProjects() {
  const grid = document.querySelector("#project-grid");
  if (!grid || !state.projects) return;
  const query = state.projectQuery.trim().toLowerCase();
  const filtered = state.projects.published.filter((project) => {
    const haystack = [project.name, project.category, project.stage, project.maturity, project.version, project.deployment, project.description, project.sourceStatus, project.sourceBoundary].join(" ").toLowerCase();
    return projectMatchesFilter(project) && (!query || haystack.includes(query));
  });

  setText("project-result-count", `${numberFormatter.format(filtered.length)} published ${filtered.length === 1 ? "project" : "projects"}${query || state.projectFilter !== "all" ? " match this pathway" : " in the public constellation"}.`);
  if (!filtered.length) {
    grid.innerHTML = '<p class="result-count">No published project matches this pathway.</p>';
    return;
  }

  grid.innerHTML = filtered.map((project) => {
    const maturity = projectMaturityLabel(project);
    const repository = project.repositoryUrl
      ? `<a class="secondary" href="${escapeHtml(project.repositoryUrl)}">Inspect repository ↗</a>`
      : "";
    return `<article class="project-card" data-accent="${escapeHtml(project.accent)}">
      <a class="project-media" href="${escapeHtml(project.url)}" aria-label="Open ${escapeHtml(project.name)} — ${escapeHtml(maturity)}">
        <span class="image-fallback">${escapeHtml(project.name)}</span>
        <img src="${escapeHtml(project.image)}" alt="" loading="lazy">
        <span class="stage-badge">${escapeHtml(maturity)}</span>
      </a>
      <div class="project-body">
        <div class="card-kicker"><span>${escapeHtml(project.category)}</span><span>${escapeHtml(project.sourceBoundary)}</span></div>
        <h3>${escapeHtml(project.name)}</h3>
        <p>${escapeHtml(project.description)}</p>
        <p class="project-boundaries"><span>${escapeHtml(project.sourceStatus)}</span>${project.deployment ? `<span>${escapeHtml(project.deployment)}</span>` : ""}</p>
        <div class="card-links"><a href="${escapeHtml(project.url)}">Explore project ↗</a>${repository}</div>
      </div>
    </article>`;
  }).join("");

  for (const image of grid.querySelectorAll("img")) {
    image.addEventListener("error", () => image.closest(".project-media")?.classList.add("image-error"), { once: true });
  }
}

function renderLaunchQueue() {
  const list = document.querySelector("#launch-list");
  if (!list || !state.projects) return;
  list.innerHTML = state.projects.publishingNext.map((project) => {
    const overview = project.overviewUrl ? `<a href="${escapeHtml(project.overviewUrl)}">Open official overview ↗</a>` : "";
    return `<article class="launch-item"><div><strong>${escapeHtml(project.name)}</strong><small>${escapeHtml(project.stage || "Forming")}</small></div><div><span>${escapeHtml(project.description)}</span>${overview}</div></article>`;
  }).join("");
}

function renderProjectSummary() {
  if (!state.projects) return;
  setText("project-total", numberFormatter.format(state.projects.published.length));
  setText("mapped-points", numberFormatter.format(state.projects.mapSnapshot.points));
  setText("mapped-relationships", numberFormatter.format(state.projects.mapSnapshot.relationships));
  setText("next-total", numberFormatter.format(state.projects.publishingNext.length));
  for (const element of document.querySelectorAll("[data-project-total]")) element.textContent = numberFormatter.format(state.projects.published.length);
  for (const element of document.querySelectorAll("[data-mapped-points]")) element.textContent = numberFormatter.format(state.projects.mapSnapshot.points);
  for (const element of document.querySelectorAll("[data-mapped-relationships]")) element.textContent = numberFormatter.format(state.projects.mapSnapshot.relationships);
  renderProjects();
  renderLaunchQueue();
}

async function loadProjects() {
  registerLoad("projects");
  try {
    state.projects = await fetchJson("data/projects.json");
    renderProjectSummary();
    completeLoad("projects", state.projects.generatedAt);
  } catch (error) {
    setText("project-result-count", "The project directory is temporarily unavailable.");
    completeLoad("projects", null, true);
    console.error("Unable to load the project directory.", error);
  }
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
  const grid = document.querySelector("#repo-grid");
  if (!grid || !state.repositories) return;
  const query = state.repoQuery.trim().toLowerCase();
  const filtered = sortedRepositories(state.repositories.repositories.filter((repo) => {
    const haystack = [repo.name, repo.description, repo.explanation, repo.language, ...(repo.topics || [])].join(" ").toLowerCase();
    return repoMatchesKind(repo)
      && (state.repoLanguage === "all" || repo.language === state.repoLanguage)
      && (!query || haystack.includes(query));
  }));

  setText("repo-result-count", `${numberFormatter.format(filtered.length)} of ${numberFormatter.format(state.repositories.counts.total)} public ${filtered.length === 1 ? "repository" : "repositories"} shown.`);
  if (!filtered.length) {
    grid.innerHTML = '<p class="result-count">No public repository matches these filters.</p>';
    return;
  }

  grid.innerHTML = filtered.map((repo) => {
    const homepage = repo.homepage ? `<a href="${escapeHtml(repo.homepage)}">Open live site ↗</a>` : "";
    const flags = [repo.fork ? "Fork" : "Non-fork", repo.archived ? "Archived" : null].filter(Boolean).join(" · ");
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
  if (!state.repositories) return;
  const { counts, repositories } = state.repositories;
  setText("repo-total-hero", numberFormatter.format(counts.total));
  setText("repo-total", numberFormatter.format(counts.total));
  setText("repo-original", numberFormatter.format(counts.original));
  setText("repo-stars", numberFormatter.format(counts.stars));
  const latest = [...repositories].sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt))[0];
  setText("repo-updated", latest ? formatMonthDay(latest.updatedAt.slice(0, 10)) : "—");
  const languageSelect = document.querySelector("#repo-language");
  if (languageSelect) {
    const languages = [...new Set(repositories.map((repo) => repo.language).filter(Boolean))].sort();
    languageSelect.innerHTML = '<option value="all">All languages</option>' + languages.map((language) => `<option value="${escapeHtml(language)}">${escapeHtml(language)}</option>`).join("");
  }
  renderRepositories();
}

async function loadRepositories() {
  registerLoad("repositories");
  try {
    state.repositories = await fetchJson("data/repos.json");
    renderRepositorySummary();
    completeLoad("repositories", state.repositories.generatedAt);
  } catch (error) {
    setText("repo-result-count", "The public repository snapshot is temporarily unavailable.");
    completeLoad("repositories", null, true);
    console.error("Unable to load the repository atlas.", error);
  }
}

function drawChart() {
  const frame = document.querySelector("#chart-frame");
  const canvas = document.querySelector("#npm-chart");
  if (!frame || !canvas || !state.chart?.points.length) return;
  const { points } = state.chart;
  const width = Math.max(frame.clientWidth, 300);
  const height = Math.max(frame.clientHeight, 260);
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
  context.fillStyle = "#6f8491";
  for (let tick = 0; tick <= 4; tick += 1) {
    const ratio = tick / 4;
    const y = padding.top + plotHeight * ratio;
    context.strokeStyle = "rgba(177,208,220,0.1)";
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
  area.addColorStop(0, "rgba(108,224,220,0.32)");
  area.addColorStop(1, "rgba(101,191,231,0.01)");
  context.beginPath();
  coordinates.forEach(({ x, y }, index) => index ? context.lineTo(x, y) : context.moveTo(x, y));
  context.lineTo(coordinates.at(-1).x, height - padding.bottom);
  context.lineTo(coordinates[0].x, height - padding.bottom);
  context.closePath();
  context.fillStyle = area;
  context.fill();

  const line = context.createLinearGradient(padding.left, 0, width - padding.right, 0);
  line.addColorStop(0, "#7ed7a6");
  line.addColorStop(0.55, "#6ce0dc");
  line.addColorStop(1, "#8f91ff");
  context.beginPath();
  coordinates.forEach(({ x, y }, index) => index ? context.lineTo(x, y) : context.moveTo(x, y));
  context.strokeStyle = line;
  context.lineWidth = 2.3;
  context.lineJoin = "round";
  context.stroke();

  const peakIndex = points.reduce((best, point, index) => point.value > points[best].value ? index : best, 0);
  const highlighted = state.chartHoverIndex ?? peakIndex;
  const point = coordinates[highlighted];
  context.strokeStyle = state.chartHoverIndex === null ? "rgba(223,195,124,0.45)" : "rgba(108,224,220,0.4)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(point.x, padding.top);
  context.lineTo(point.x, height - padding.bottom);
  context.stroke();
  context.fillStyle = state.chartHoverIndex === null ? "#dfc37c" : "#6ce0dc";
  context.beginPath();
  context.arc(point.x, point.y, 4.3, 0, Math.PI * 2);
  context.fill();

  state.chartPlot = { width, padding, plotWidth, coordinates };
  canvas.setAttribute("aria-label", `${numberFormatter.format(points.reduce((sum, item) => sum + item.value, 0))} official npm range downloads from ${formatDate(points[0].date)} through ${formatDate(points.at(-1).date)}. A complete daily table follows the chart.`);
}

function updateChartTooltip(event) {
  const canvas = document.querySelector("#npm-chart");
  const tooltip = document.querySelector("#chart-tooltip");
  if (!canvas || !tooltip || !state.chart?.points.length || !state.chartPlot) return;
  const bounds = canvas.getBoundingClientRect();
  const localX = Math.max(state.chartPlot.padding.left, Math.min(event.clientX - bounds.left, state.chartPlot.width - state.chartPlot.padding.right));
  const ratio = (localX - state.chartPlot.padding.left) / state.chartPlot.plotWidth;
  const index = Math.max(0, Math.min(state.chart.points.length - 1, Math.round(ratio * (state.chart.points.length - 1))));
  if (state.chartHoverIndex !== index) {
    state.chartHoverIndex = index;
    drawChart();
  }
  const point = state.chart.points[index];
  const coordinate = state.chartPlot.coordinates[index];
  tooltip.innerHTML = `<b>${escapeHtml(formatDate(point.date))}</b>${numberFormatter.format(point.value)} downloads`;
  tooltip.hidden = false;
  tooltip.style.left = `${Math.max(8, Math.min(coordinate.x + 10, state.chartPlot.width - 155))}px`;
  tooltip.style.top = `${Math.max(8, coordinate.y - 26)}px`;
}

function hideChartTooltip() {
  const tooltip = document.querySelector("#chart-tooltip");
  if (tooltip) tooltip.hidden = true;
  state.chartHoverIndex = null;
  drawChart();
}

function renderNpm() {
  if (!state.npm || !state.npmHistory) return;
  const history = state.npmHistory;
  const fromYear = history.period.availableFrom.slice(0, 4);
  const untilYear = history.period.availableUntil.slice(0, 4);
  setText("npm-chart-kicker", fromYear === untilYear ? `Official ${fromYear} range` : `Official ${fromYear}–${untilYear} range`);
  setText("npm-history-total", numberFormatter.format(history.total));
  setText("npm-week", numberFormatter.format(state.npm.totals.week));
  setText("npm-month", numberFormatter.format(state.npm.totals.month));
  setText("npm-year", numberFormatter.format(state.npm.totals.year));
  setText("npm-chart-period", `${formatDate(history.period.availableFrom)}–${formatDate(history.period.availableUntil)} · official daily range series`);
  setText("npm-first-day", history.firstRecordedDay ? `${formatDate(history.firstRecordedDay.date)} · ${numberFormatter.format(history.firstRecordedDay.downloads)}` : "No recorded downloads");
  setText("npm-peak-day", history.peakDay ? `${formatDate(history.peakDay.date)} · ${numberFormatter.format(history.peakDay.downloads)}` : "No recorded downloads");
  setText("npm-coverage", `${numberFormatter.format(history.dates.length)} official range days · ${numberFormatter.format(history.packageCount)} ${history.packageCount === 1 ? "module" : "modules"}`);

  const refreshed = `refreshed ${formatTimestamp(history.generatedAt)}`;
  if (!history.dataQuality.referenceAvailable) {
    setText("npm-status", `Official npm range series is authoritative; optional npm-stat comparison unavailable · ${refreshed}`);
  } else if (history.dataQuality.exactMatch) {
    setText("npm-status", `Official npm range series is authoritative; optional npm-stat comparison matches point for point · ${refreshed}`);
  } else {
    setText("npm-status", `Official npm range series remains published unchanged; optional npm-stat comparison differs · ${refreshed}`);
  }

  const caption = document.querySelector("#npm-daily-caption");
  const body = document.querySelector("#npm-daily-body");
  const packages = document.querySelector("#package-list");
  if (caption) caption.textContent = `Official daily npm range downloads for all maintained modules from ${formatDate(history.period.availableFrom)} through ${formatDate(history.period.availableUntil)}`;
  if (body) body.innerHTML = history.dates.map((date, index) => `<tr><th scope="row"><time datetime="${escapeHtml(date)}">${escapeHtml(formatDate(date))}</time></th><td>${numberFormatter.format(history.overall[index])}</td></tr>`).join("");
  if (packages) packages.innerHTML = state.npm.packages.map((pkg) => `<article class="package-row"><div><strong>${escapeHtml(pkg.name)} · v${escapeHtml(pkg.version)}</strong><span>${escapeHtml(pkg.description)} · ${escapeHtml(pkg.license || "license not listed")} · ${numberFormatter.format(pkg.downloads.year)} rolling-year downloads</span></div><a href="${escapeHtml(pkg.links.npm)}">NPM ↗</a></article>`).join("");

  state.chart = { points: history.dates.map((date, index) => ({ date, value: history.overall[index] })) };
  drawChart();
}

async function loadNpm() {
  registerLoad("npm");
  try {
    [state.npm, state.npmHistory] = await Promise.all([
      fetchJson("data/npm-stats.json"),
      fetchJson("data/npm-history.json"),
    ]);
    renderNpm();
    completeLoad("npm", state.npmHistory.generatedAt);
  } catch (error) {
    setText("npm-status", "Official NPM telemetry is temporarily unavailable.");
    const body = document.querySelector("#npm-daily-body");
    const canvas = document.querySelector("#npm-chart");
    if (body) body.innerHTML = '<tr><td colspan="2">Daily values are temporarily unavailable.</td></tr>';
    if (canvas) canvas.setAttribute("aria-label", "Official NPM telemetry is temporarily unavailable; the static rolling totals remain visible.");
    completeLoad("npm", null, true);
    console.error("Unable to load verified NPM telemetry.", error);
  }
}

function wireProjectControls() {
  document.querySelector("#project-search")?.addEventListener("input", (event) => {
    state.projectQuery = event.target.value;
    renderProjects();
  });
  document.querySelector("#project-filters")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-project-filter]");
    if (!button) return;
    state.projectFilter = button.dataset.projectFilter;
    for (const candidate of button.parentElement.querySelectorAll("button")) candidate.setAttribute("aria-pressed", String(candidate === button));
    renderProjects();
  });
}

function wireRepositoryControls() {
  document.querySelector("#repo-search")?.addEventListener("input", (event) => {
    state.repoQuery = event.target.value;
    renderRepositories();
  });
  document.querySelector("#repo-language")?.addEventListener("change", (event) => {
    state.repoLanguage = event.target.value;
    renderRepositories();
  });
  document.querySelector("#repo-sort")?.addEventListener("change", (event) => {
    state.repoSort = event.target.value;
    renderRepositories();
  });
  document.querySelector("#repo-filters")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-repo-kind]");
    if (!button) return;
    state.repoKind = button.dataset.repoKind;
    for (const candidate of button.parentElement.querySelectorAll("button")) candidate.setAttribute("aria-pressed", String(candidate === button));
    renderRepositories();
  });
}

function wireChart() {
  const canvas = document.querySelector("#npm-chart");
  if (!canvas) return;
  canvas.addEventListener("pointermove", updateChartTooltip);
  canvas.addEventListener("pointerleave", hideChartTooltip);
  canvas.addEventListener("pointercancel", hideChartTooltip);
  window.addEventListener("resize", () => window.requestAnimationFrame(drawChart));
}

function initialize() {
  for (const year of document.querySelectorAll("[data-current-year]")) year.textContent = String(new Date().getFullYear());
  markCurrentPage();
  wireMenu();
  wireProjectControls();
  wireRepositoryControls();
  wireChart();

  const loads = [];
  if (document.querySelector("#project-grid, #project-total, #mapped-points, #mapped-relationships, #next-total, #launch-list")) loads.push(loadProjects());
  if (document.querySelector("#repo-grid, #repo-total, #repo-total-hero, #repo-original, #repo-stars, #repo-updated")) loads.push(loadRepositories());
  if (document.querySelector("#npm-chart")) loads.push(loadNpm());
  Promise.allSettled(loads).then(updateFreshness);
}

initialize();
