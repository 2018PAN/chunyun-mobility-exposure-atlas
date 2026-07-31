(() => {
  "use strict";

  const DATA = window.ATLAS_DATA;
  if (!DATA) {
    document.body.innerHTML =
      '<main class="load-error"><h1>Data unavailable</h1><p>Run the data builder before opening this page.</p></main>';
    return;
  }

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const ROUTES = {
    overview: "Overview",
    spatial: "Spatial Pattern",
    models: "Model Comparison",
    shap: "SHAP Explorer",
    interpretation: "Methods & Notes",
  };

  const state = {
    overviewComparison: "festival_pre",
    spatialComparison: "festival_pre",
    spatialTarget: "population_activity",
    spatialView: "numeric",
    provinceMetric: "mean",
    modelComparison: "festival_pre",
    modelTarget: "total_exposure",
    modelMetric: "r2",
    importanceSource: "xgboost",
    shapComparison: "festival_pre",
    shapTarget: "total_exposure",
    shapFeature: null,
  };

  const cache = new Map();
  let boundary = null;
  let spatialMap = null;
  let shapMap = null;
  let trendTooltip = null;

  const COLORS = {
    exposure: "#d97706",
    mobility: "#2563eb",
    pollution: "#0f766e",
    interaction: "#7c3aed",
    navy: "#1e3a5f",
    grid: "#e2e8f0",
    text: "#334155",
  };

  const CLUSTER_COLOR = new Map(
    DATA.spatial.clusterMeta.map((item) => [item.code, item.color]),
  );
  const CLUSTER_LABEL = new Map(
    DATA.spatial.clusterMeta.map((item) => [item.code, item.label]),
  );

  const CHINA_ALBERS = (() => {
    const semiMajor = 6378137;
    const flattening = 1 / 298.257222101;
    const eccentricity = Math.sqrt(
      2 * flattening - flattening * flattening,
    );
    const eccentricitySquared = eccentricity * eccentricity;
    const radians = (degrees) => (degrees * Math.PI) / 180;
    const q = (latitude) => {
      const sine = Math.sin(latitude);
      const eccentricSine = eccentricity * sine;
      return (
        (1 - eccentricitySquared) *
        (sine / (1 - eccentricitySquared * sine * sine) -
          Math.log((1 - eccentricSine) / (1 + eccentricSine)) /
            (2 * eccentricity))
      );
    };
    const m = (latitude) =>
      Math.cos(latitude) /
      Math.sqrt(
        1 -
          eccentricitySquared *
            Math.sin(latitude) *
            Math.sin(latitude),
      );
    const standardParallel1 = radians(25);
    const standardParallel2 = radians(47);
    const centralMeridian = radians(105);
    const latitudeOfOrigin = radians(0);
    const m1 = m(standardParallel1);
    const m2 = m(standardParallel2);
    const q1 = q(standardParallel1);
    const q2 = q(standardParallel2);
    const n = (m1 * m1 - m2 * m2) / (q2 - q1);
    const c = m1 * m1 + n * q1;
    const rho0 =
      (semiMajor * Math.sqrt(c - n * q(latitudeOfOrigin))) / n;
    return (longitude, latitude) => {
      const lambda = radians(longitude);
      const phi = radians(latitude);
      const rho = (semiMajor * Math.sqrt(c - n * q(phi))) / n;
      const theta = n * (lambda - centralMeridian);
      return [rho * Math.sin(theta), rho0 - rho * Math.cos(theta)];
    };
  })();

  const CHINA_PROJECTED_BOUNDS = (() => {
    const projected = [];
    const samples = 160;
    for (let index = 0; index <= samples; index += 1) {
      const ratio = index / samples;
      const longitude = 73 + ratio * (135 - 73);
      const latitude = 18 + ratio * (54 - 18);
      projected.push(CHINA_ALBERS(longitude, 18));
      projected.push(CHINA_ALBERS(135, latitude));
      projected.push(CHINA_ALBERS(135 - ratio * (135 - 73), 54));
      projected.push(CHINA_ALBERS(73, 54 - ratio * (54 - 18)));
    }
    const xs = projected.map((point) => point[0]);
    const ys = projected.map((point) => point[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const xPad = (maxX - minX) * 0.012;
    const yPad = (maxY - minY) * 0.012;
    return [minX - xPad, minY - yPad, maxX + xPad, maxY + yPad];
  })();

  const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
  const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  const percent = new Intl.NumberFormat("en-US", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function positionFloatingTooltip(tooltip, anchorX, anchorY, placement = "right") {
    const viewportPadding = 12;
    const gap = 12;
    const bounds = tooltip.getBoundingClientRect();
    let left;
    let top;
    let side = placement;

    if (placement === "top") {
      left = anchorX - bounds.width / 2;
      top = anchorY - bounds.height - gap;
      if (top < viewportPadding) {
        top = anchorY + gap;
        side = "bottom";
      }
    } else {
      left = anchorX + gap;
      top = anchorY - bounds.height / 2;
      if (left + bounds.width > window.innerWidth - viewportPadding) {
        left = anchorX - bounds.width - gap;
        side = "left";
      }
    }

    left = Math.max(
      viewportPadding,
      Math.min(left, window.innerWidth - bounds.width - viewportPadding),
    );
    top = Math.max(
      viewportPadding,
      Math.min(top, window.innerHeight - bounds.height - viewportPadding),
    );

    tooltip.dataset.side = side;
    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(top)}px`;
  }

  function compact(value, digits = 1) {
    if (!Number.isFinite(value)) return "—";
    const absolute = Math.abs(value);
    const scales = [
      [1e15, "Q"],
      [1e12, "T"],
      [1e9, "B"],
      [1e6, "M"],
      [1e3, "K"],
    ];
    const selected = scales.find(([scale]) => absolute >= scale);
    if (!selected) return number.format(value);
    const [scale, suffix] = selected;
    return `${(value / scale).toFixed(digits)}${suffix}`;
  }

  function signed(value, formatter = compact) {
    if (!Number.isFinite(value)) return "—";
    const formatted =
      typeof formatter === "function"
        ? formatter(Math.abs(value))
        : formatter.format(Math.abs(value));
    return `${value > 0 ? "+" : value < 0 ? "−" : ""}${formatted}`;
  }

  function pctChange(next, previous) {
    if (!Number.isFinite(next) || !Number.isFinite(previous) || previous === 0) {
      return null;
    }
    return (next - previous) / Math.abs(previous);
  }

  function comparisonPeriods(comparison) {
    return comparison === "festival_pre"
      ? { base: "pre", next: "festival" }
      : { base: "festival", next: "post" };
  }

  function comparisonKey(comparison, metric) {
    const prefix =
      comparison === "festival_pre" ? "festivalPre" : "postFestival";
    return `${prefix}${metric}`;
  }

  function kpiCard(label, value, note, color) {
    return `
      <article class="kpi-card" style="--kpi-accent:${color}">
        <span class="kpi-label">${escapeHtml(label)}</span>
        <strong class="kpi-value">${escapeHtml(value)}</strong>
        <span class="kpi-note">${escapeHtml(note)}</span>
      </article>
    `;
  }

  async function getJson(relativePath) {
    if (cache.has(relativePath)) return cache.get(relativePath);
    const promise = fetch(`./${relativePath.replace(/^\.\//, "")}`).then(
      async (response) => {
        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`);
        }
        return response.json();
      },
    );
    cache.set(relativePath, promise);
    return promise;
  }

  async function getBoundary() {
    if (boundary) return boundary;
    boundary = await getJson(DATA.meta.boundaryFile);
    return boundary;
  }

  function updateControl(name, value) {
    $$(`[data-control="${name}"] button`).forEach((button) => {
      const active = button.dataset.value === value;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function setupSegmentedControls() {
    const handlers = {
      "overview-comparison": (value) => {
        state.overviewComparison = value;
        renderOverview();
      },
      "spatial-comparison": (value) => {
        state.spatialComparison = value;
        renderSpatial();
      },
      "spatial-view": (value) => {
        const layer =
          DATA.spatial.layers[
            `${state.spatialComparison}:${state.spatialTarget}`
          ];
        state.spatialView =
          value === "lisa" && layer?.hasLisa ? "lisa" : "numeric";
        renderSpatial();
      },
      "model-comparison": (value) => {
        state.modelComparison = value;
        renderModels();
      },
      "model-target": (value) => {
        state.modelTarget = value;
        renderModels();
      },
      "model-metric": (value) => {
        state.modelMetric = value;
        renderModels();
      },
      "shap-comparison": (value) => {
        state.shapComparison = value;
        state.shapFeature = null;
        renderShap();
      },
      "shap-target": (value) => {
        state.shapTarget = value;
        state.shapFeature = null;
        renderShap();
      },
    };

    $$("[data-control]").forEach((control) => {
      control.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-value]");
        if (!button) return;
        const handler = handlers[control.dataset.control];
        if (handler) handler(button.dataset.value);
      });
    });

    $("#spatial-layer-select")?.addEventListener("change", (event) => {
      state.spatialTarget = event.target.value;
      const layer =
        DATA.spatial.layers[
          `${state.spatialComparison}:${state.spatialTarget}`
        ];
      if (!layer?.hasLisa) state.spatialView = "numeric";
      renderSpatial();
    });
    $("#province-metric-select")?.addEventListener("change", (event) => {
      state.provinceMetric = event.target.value;
      renderSpatialProvinceRanking();
    });
    $("#importance-source-select")?.addEventListener("change", (event) => {
      state.importanceSource = event.target.value;
      renderModels();
    });
    $("#shap-feature-select")?.addEventListener("change", (event) => {
      state.shapFeature = event.target.value;
      renderShap();
    });
  }

  function route() {
    const name = location.hash.replace(/^#\//, "") || "overview";
    return ROUTES[name] ? name : "overview";
  }

  function renderRoute() {
    const active = route();
    if (trendTooltip) trendTooltip.hidden = true;
    if (active !== "spatial") spatialMap?.clearSelection();
    if (active !== "shap") shapMap?.clearSelection();
    $$(".page").forEach((page) => {
      page.hidden = page.dataset.page !== active;
    });
    $$("[data-route]").forEach((link) => {
      const isActive = link.dataset.route === active;
      link.classList.toggle("is-active", isActive);
      if (isActive) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    $("#route-title").textContent = ROUTES[active];
    document.title = `${ROUTES[active]} · Mobility & Exposure Atlas`;
    window.scrollTo({ top: 0, behavior: "auto" });

    if (active === "spatial") {
      window.setTimeout(() => {
        spatialMap?.resize();
        renderSpatialMap();
      }, 30);
    }
    if (active === "shap") {
      window.setTimeout(() => {
        shapMap?.resize();
        renderShapMap();
      }, 30);
    }
  }

  function renderOverview() {
    const comparison = state.overviewComparison;
    updateControl("overview-comparison", comparison);
    const periods = comparisonPeriods(comparison);
    const base = DATA.overview.periods.find((item) => item.id === periods.base);
    const next = DATA.overview.periods.find((item) => item.id === periods.next);
    const decomposition = DATA.overview.decomposition[comparison];
    const change = DATA.overview.changeSummary[comparison];
    const moran = DATA.spatial.moran.find(
      (item) =>
        item.comparison === comparison &&
        item.target === "total_exposure",
    );
    $("#overview-kpis").innerHTML = [
      kpiCard(
        "National exposure change",
        signed(decomposition.total),
        `${DATA.meta.comparisons[comparison].shortLabel} · ${DATA.meta.exposureUnit}`,
        COLORS.exposure,
      ),
      kpiCard(
        "Exposure-increase grids",
        percent.format(change.exposure.positiveShare),
        `${integer.format(change.exposure.count)} complete 10 km cells`,
        COLORS.mobility,
      ),
      kpiCard(
        "Activity-increase grids",
        percent.format(change.activity.positiveShare),
        `${base.label} → ${next.label}`,
        COLORS.pollution,
      ),
      kpiCard(
        "Global Moran’s I",
        moran.moranI.toFixed(3),
        `${moran.pValue < 0.001 ? "p < 0.001" : `p = ${moran.pValue.toFixed(3)}`} · 999 permutations`,
        COLORS.navy,
      ),
    ].join("");

    renderTrend();
    renderDecomposition(comparison);
    renderProvinceTable(comparison);
  }

  function renderTrend() {
    const root = $("#overview-trend");
    trendTooltip?.remove();
    trendTooltip = null;
    const daily = DATA.overview.daily;
    const pre = daily.filter((item) => item.period === "Pre-festival");
    const exposureBase =
      pre.reduce((sum, item) => sum + item.exposure, 0) / pre.length;
    const pmBase = pre.reduce((sum, item) => sum + item.pm25, 0) / pre.length;
    const points = daily.map((item) => ({
      ...item,
      exposureIndex: (item.exposure / exposureBase) * 100,
      pmIndex: (item.pm25 / pmBase) * 100,
    }));

    const width = 940;
    const height = 320;
    const margin = { top: 18, right: 18, bottom: 34, left: 45 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const all = points.flatMap((item) => [item.exposureIndex, item.pmIndex]);
    const minY = Math.floor(Math.min(...all, 92) / 10) * 10;
    const maxY = Math.ceil(Math.max(...all, 108) / 10) * 10;
    const x = (index) =>
      margin.left + (index / Math.max(1, points.length - 1)) * innerWidth;
    const y = (value) =>
      margin.top + ((maxY - value) / Math.max(1, maxY - minY)) * innerHeight;
    const line = (accessor) =>
      points
        .map(
          (item, index) =>
            `${index ? "L" : "M"}${x(index).toFixed(2)},${y(accessor(item)).toFixed(2)}`,
        )
        .join(" ");
    const ticks = Array.from({ length: 5 }, (_, index) => {
      return minY + (index / 4) * (maxY - minY);
    });

    root.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="trend-title trend-desc">
        <title id="trend-title">Daily exposure and weighted PM2.5 indices</title>
        <desc id="trend-desc">Two indexed time series from 1 February to 12 March 2018, with the pre-festival mean set to 100.</desc>
        ${ticks
          .map(
            (tick) => `
            <line class="chart-grid" x1="${margin.left}" y1="${y(tick)}" x2="${width - margin.right}" y2="${y(tick)}"></line>
            <text class="chart-axis" x="${margin.left - 9}" y="${y(tick) + 3}" text-anchor="end">${Math.round(tick)}</text>
          `,
          )
          .join("")}
        <path d="${line((item) => item.exposureIndex)}" fill="none" stroke="${COLORS.exposure}" stroke-width="3"></path>
        <path d="${line((item) => item.pmIndex)}" fill="none" stroke="${COLORS.pollution}" stroke-width="2.5" stroke-dasharray="7 5"></path>
        <line id="trend-guide" x1="0" x2="0" y1="${margin.top}" y2="${height - margin.bottom}" stroke="#94a3b8" stroke-dasharray="3 3" hidden></line>
        <circle id="trend-exposure-dot" r="4.5" fill="${COLORS.exposure}" stroke="#fff" stroke-width="2" hidden></circle>
        <circle id="trend-pm-dot" r="4.5" fill="${COLORS.pollution}" stroke="#fff" stroke-width="2" hidden></circle>
        <text class="chart-axis" x="${margin.left}" y="${height - 8}">01 Feb</text>
        <text class="chart-axis" x="${x(14)}" y="${height - 8}" text-anchor="middle">15 Feb · Festival</text>
        <text class="chart-axis" x="${width - margin.right}" y="${height - 8}" text-anchor="end">12 Mar</text>
        <rect id="trend-hit" x="${margin.left}" y="${margin.top}" width="${innerWidth}" height="${innerHeight}" fill="transparent" tabindex="0" aria-label="Interactive daily trend chart"></rect>
      </svg>
      <div class="chart-tooltip" hidden></div>
    `;

    const hit = $("#trend-hit", root);
    const guide = $("#trend-guide", root);
    const exposureDot = $("#trend-exposure-dot", root);
    const pmDot = $("#trend-pm-dot", root);
    const tooltip = $(".chart-tooltip", root);
    const svg = $("svg", root);
    tooltip.classList.add("is-floating");
    document.body.appendChild(tooltip);
    trendTooltip = tooltip;

    function showAt(index) {
      const item = points[Math.max(0, Math.min(points.length - 1, index))];
      const px = x(points.indexOf(item));
      guide.hidden = false;
      guide.setAttribute("x1", px);
      guide.setAttribute("x2", px);
      exposureDot.hidden = false;
      exposureDot.setAttribute("cx", px);
      exposureDot.setAttribute("cy", y(item.exposureIndex));
      pmDot.hidden = false;
      pmDot.setAttribute("cx", px);
      pmDot.setAttribute("cy", y(item.pmIndex));
      tooltip.hidden = false;
      tooltip.innerHTML = `
        <strong>${escapeHtml(item.date)} · ${escapeHtml(item.period)}</strong>
        <span>Exposure: ${item.exposureIndex.toFixed(1)}</span><br>
        <span>Weighted PM₂.₅: ${item.pmIndex.toFixed(1)}</span>
      `;
      const svgRect = svg.getBoundingClientRect();
      positionFloatingTooltip(
        tooltip,
        svgRect.left + (px / width) * svgRect.width,
        svgRect.top +
          (Math.min(y(item.exposureIndex), y(item.pmIndex)) / height) *
            svgRect.height,
        "top",
      );
      hit.setAttribute(
        "aria-label",
        `${item.date}. Exposure index ${item.exposureIndex.toFixed(1)}. Weighted PM2.5 index ${item.pmIndex.toFixed(1)}.`,
      );
    }

    hit.addEventListener("pointermove", (event) => {
      const rect = hit.getBoundingClientRect();
      const ratio = (event.clientX - rect.left) / rect.width;
      showAt(Math.round(ratio * (points.length - 1)));
    });
    hit.addEventListener("pointerleave", () => {
      guide.hidden = exposureDot.hidden = pmDot.hidden = tooltip.hidden = true;
    });
    hit.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const current = Number(hit.dataset.index || 0);
      const next =
        event.key === "ArrowRight"
          ? Math.min(points.length - 1, current + 1)
          : Math.max(0, current - 1);
      hit.dataset.index = String(next);
      showAt(next);
    });

    $("#period-strip").innerHTML = `
      <span>Pre-festival · 14 days</span>
      <span>Festival · 7 days</span>
      <span>Post-festival · 19 days</span>
    `;
  }

  function renderDecomposition(comparison) {
    const values = DATA.overview.decomposition[comparison];
    const rows = [
      ["Mobility", values.mobility, COLORS.mobility],
      ["Pollution", values.pollution, COLORS.pollution],
      ["Interaction", values.interaction, COLORS.interaction],
    ];
    const max = Math.max(...rows.map((row) => Math.abs(row[1])), 1);
    $("#decomposition-chart").innerHTML = rows
      .map(([label, value, color]) => {
        const width = (Math.abs(value) / max) * 48;
        const left = value >= 0 ? 50 : 50 - width;
        return `
          <div class="decomposition-row">
            <span>${label}</span>
            <div class="decomposition-track" aria-label="${label}: ${signed(value)}">
              <i style="left:${left}%;width:${width}%;background:${color}"></i>
            </div>
            <strong>${signed(value)}</strong>
          </div>
        `;
      })
      .join("");

    const spec = DATA.meta.comparisons[comparison];
    const dominant = rows.reduce((best, row) =>
      Math.abs(row[1]) > Math.abs(best[1]) ? row : best,
    );
    $("#decomposition-total").textContent =
      `${signed(values.total)} ${DATA.meta.exposureUnit}`;
    $("#decomposition-context").textContent =
      `${spec.baseline} to ${spec.comparison}. Bars diverge from zero; length reflects absolute contribution.`;
    $("#decomposition-insight").textContent =
      `${dominant[0]} is the dominant national contribution, accounting for ${percent.format(Math.abs(dominant[1]) / Math.max(Math.abs(values.total), 1))} of the absolute observed change.`;
  }

  function renderProvinceTable(comparison) {
    const exposureKey = comparisonKey(comparison, "ExposureChange");
    const populationKey = comparisonKey(comparison, "PopulationChange");
    const pmKey = comparisonKey(comparison, "Pm25Change");
    const rows = [...DATA.overview.provinces]
      .sort((a, b) => Math.abs(b[exposureKey]) - Math.abs(a[exposureKey]))
      .slice(0, 10);
    $("#province-table").innerHTML = rows
      .map(
        (row) => `
          <tr>
            <td><strong>${escapeHtml(row.province)}</strong></td>
            <td class="numeric"><span class="delta ${row[exposureKey] >= 0 ? "positive" : "negative"}">${signed(row[exposureKey])}</span></td>
            <td class="numeric">${signed(row[populationKey])}</td>
            <td class="numeric">${signed(row[pmKey], (value) => `${value.toFixed(1)} μg/m³`)}</td>
          </tr>
        `,
      )
      .join("");
  }

  function renderSpatial() {
    const comparison = state.spatialComparison;
    const target = state.spatialTarget;
    updateControl("spatial-comparison", comparison);
    const layer = DATA.spatial.layers[`${comparison}:${target}`];
    const targetSpec = DATA.meta.spatialLayers[target];
    const comparisonSpec = DATA.meta.comparisons[comparison];
    $("#spatial-layer-select").value = target;
    if (!layer.hasLisa && state.spatialView === "lisa") {
      state.spatialView = "numeric";
    }
    updateControl("spatial-view", state.spatialView);
    const lisaButton = $(
      '[data-control="spatial-view"] button[data-value="lisa"]',
    );
    lisaButton.disabled = !layer.hasLisa;
    lisaButton.title = layer.hasLisa
      ? "Show significant Local Moran’s I clusters"
      : "LISA results are available for exposure and decomposition components";

    $("#spatial-map-title").textContent =
      `${targetSpec.label} · ${comparisonSpec.shortLabel}`;
    $("#spatial-map-eyebrow").textContent =
      state.spatialView === "lisa"
        ? "Local Moran’s I"
        : "Grid-cell change surface";
    $("#spatial-cluster-card").hidden = state.spatialView !== "lisa";

    if (state.spatialView === "lisa") {
      const row = DATA.spatial.moran.find(
        (item) => item.comparison === comparison && item.target === target,
      );
      $("#spatial-summary-eyebrow").textContent = "Global autocorrelation";
      $("#spatial-summary-label").textContent = "Moran’s I";
      $("#moran-value").textContent = row.moranI.toFixed(3);
      $("#moran-p").textContent =
        row.pValue < 0.001 ? "< 0.001" : row.pValue.toFixed(3);
      $("#moran-grids").textContent = integer.format(row.nGrids);
      $("#spatial-mini-label-1").textContent = "p-value";
      $("#spatial-mini-label-3").textContent = "Distance band";
      $("#spatial-mini-value-3").textContent = "50 km";
      const strength =
        Math.abs(row.moranI) >= 0.5
          ? "strong"
          : Math.abs(row.moranI) >= 0.25
            ? "moderate"
            : "weak";
      $("#moran-summary").textContent =
        `${comparisonSpec.shortLabel} shows ${strength} ${row.moranI >= 0 ? "positive" : "negative"} spatial autocorrelation for ${targetSpec.shortLabel.toLowerCase()}.`;
    } else {
      $("#spatial-summary-eyebrow").textContent = "Change distribution";
      $("#spatial-summary-label").textContent = "Grid-cell mean";
      $("#moran-value").textContent = "—";
      $("#moran-p").textContent = "—";
      $("#moran-grids").textContent = integer.format(layer.pointCount);
      $("#spatial-mini-label-1").textContent = "Median";
      $("#spatial-mini-label-3").textContent = "Positive share";
      $("#spatial-mini-value-3").textContent = "—";
      $("#moran-summary").textContent =
        "Summary statistics use every complete grid cell; the map colour range is clipped only for display.";
    }

    const metaByLabel = new Map(
      DATA.spatial.clusterMeta.map((item) => [item.label.replaceAll("–", "-"), item]),
    );
    const ordered = [...layer.clusters].sort((a, b) => {
      const order = [
        "High-High",
        "Low-Low",
        "High-Low",
        "Low-High",
        "Not significant",
        "NoData",
      ];
      return order.indexOf(a.cluster) - order.indexOf(b.cluster);
    });
    $("#cluster-stack").innerHTML = ordered
      .map((item) => {
        const meta = metaByLabel.get(item.cluster) || { color: "#e2e8f0" };
        return `<i style="width:${item.share * 100}%;background:${meta.color}"></i>`;
      })
      .join("");
    $("#cluster-list").innerHTML = ordered
      .map((item) => {
        const meta = metaByLabel.get(item.cluster) || {
          color: "#e2e8f0",
          label: item.cluster,
        };
        return `
          <div class="cluster-list-row">
            <span><i style="background:${meta.color}"></i>${escapeHtml(meta.label)}</span>
            <strong>${percent.format(item.share)} · ${compact(item.gridCount, 0)}</strong>
          </div>
        `;
      })
      .join("");

    $("#spatial-legend").innerHTML = DATA.spatial.clusterMeta
      .filter((item) => state.spatialView === "lisa" && item.code !== 5)
      .map(
        (item) =>
          `<span><i style="background:${item.color}"></i>${escapeHtml(item.label)}</span>`,
      )
      .join("");

    const comparisonRows = DATA.spatial.moran.filter(
      (item) => item.comparison === comparison,
    );
    const max = Math.max(...comparisonRows.map((item) => Math.abs(item.moranI)), 0.01);
    $("#moran-comparison").innerHTML = comparisonRows
      .sort(
        (a, b) =>
          ["total_exposure", "mobility", "pollution"].indexOf(a.target) -
          ["total_exposure", "mobility", "pollution"].indexOf(b.target),
      )
      .map((item) => {
        const spec = DATA.meta.targets[item.target];
        return `
          <div class="moran-item" style="--item-color:${spec.color}">
            <div class="moran-item-head">
              <span>${escapeHtml(spec.label)}</span>
              <strong>${item.moranI.toFixed(3)}</strong>
            </div>
            <div class="moran-track"><i style="width:${(Math.abs(item.moranI) / max) * 100}%"></i></div>
          </div>
        `;
      })
      .join("");

    renderSpatialProvinceRanking();
    if (route() === "spatial") renderSpatialMap();
  }

  function renderSpatialProvinceRanking() {
    const layer =
      DATA.spatial.layers[
        `${state.spatialComparison}:${state.spatialTarget}`
      ];
    if (!layer) return;
    const metric = state.provinceMetric;
    $("#province-metric-select").value = metric;
    const rows = [...layer.provinceStats]
      .filter((item) => Number.isFinite(item[metric]))
      .sort((a, b) => Math.abs(b[metric]) - Math.abs(a[metric]))
      .slice(0, 10);
    const max = Math.max(...rows.map((item) => Math.abs(item[metric])), 1);
    $("#spatial-province-ranking").innerHTML = rows
      .map((item, index) => {
        const value =
          metric === "positiveShare"
            ? percent.format(item[metric])
            : signed(item[metric]);
        return `
          <div class="province-rank-row">
            <span class="province-rank-index">${String(index + 1).padStart(2, "0")}</span>
            <div>
              <div class="province-rank-head"><strong>${escapeHtml(item.province)}</strong><span>${escapeHtml(value)}</span></div>
              <div class="province-rank-track"><i style="width:${(Math.abs(item[metric]) / max) * 100}%"></i></div>
            </div>
          </div>
        `;
      })
      .join("");
  }

  function renderSpatialDistribution(mapData) {
    const values = [];
    for (let index = 0; index < mapData.points.length; index += mapData.stride) {
      const value = mapData.points[index + 3];
      if (Number.isFinite(value)) values.push(value);
    }
    if (!values.length) return;
    const sorted = [...values].sort((a, b) => a - b);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const median = sorted[Math.floor(sorted.length / 2)];
    const positiveShare =
      values.filter((value) => value > 0).length / values.length;
    if (state.spatialView === "numeric") {
      $("#moran-value").textContent = signed(mean);
      $("#moran-p").textContent = signed(median);
      $("#spatial-mini-value-3").textContent = percent.format(positiveShare);
    }
    const [low, high] = mapData.valueExtent;
    const bins = Array.from({ length: 28 }, () => 0);
    values.forEach((value) => {
      const clipped = Math.max(low, Math.min(high, value));
      const ratio = (clipped - low) / Math.max(high - low, 1e-9);
      bins[Math.min(bins.length - 1, Math.floor(ratio * bins.length))] += 1;
    });
    const width = 720;
    const height = 220;
    const margin = { top: 14, right: 18, bottom: 40, left: 38 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const maxBin = Math.max(...bins, 1);
    const zeroX =
      margin.left + ((0 - low) / Math.max(high - low, 1e-9)) * plotWidth;
    $("#spatial-distribution").innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Histogram of grid-cell change values">
        ${bins
          .map((count, index) => {
            const barWidth = plotWidth / bins.length;
            const barHeight = (count / maxBin) * plotHeight;
            const value = low + ((index + 0.5) / bins.length) * (high - low);
            return `<rect x="${margin.left + index * barWidth + 1}" y="${margin.top + plotHeight - barHeight}" width="${Math.max(1, barWidth - 2)}" height="${barHeight}" rx="1.5" fill="${divergingColor(value, [low, high])}"></rect>`;
          })
          .join("")}
        ${zeroX >= margin.left && zeroX <= width - margin.right ? `<line x1="${zeroX}" x2="${zeroX}" y1="${margin.top}" y2="${margin.top + plotHeight}" stroke="#334155" stroke-width="1"></line>` : ""}
        <line x1="${margin.left}" x2="${width - margin.right}" y1="${margin.top + plotHeight}" y2="${margin.top + plotHeight}" stroke="#cbd5e1"></line>
        <text class="chart-axis" x="${margin.left}" y="${height - 12}">${escapeHtml(signed(low))}</text>
        <text class="chart-axis" x="${width - margin.right}" y="${height - 12}" text-anchor="end">${escapeHtml(signed(high))}</text>
        <text class="chart-axis" x="${margin.left + plotWidth / 2}" y="${height - 12}" text-anchor="middle">Grid-cell change</text>
      </svg>
    `;
  }

  async function renderSpatialMap() {
    const loading = $("#spatial-loading");
    loading.hidden = false;
    loading.textContent = "Loading spatial cells…";
    try {
      const key = `${state.spatialComparison}:${state.spatialTarget}`;
      const descriptor = DATA.spatial.layers[key];
      const [mapData, boundaryData] = await Promise.all([
        getJson(descriptor.dataFile),
        getBoundary(),
      ]);
      if (!spatialMap) {
        spatialMap = new CanvasGeoMap({
          canvas: $("#spatial-canvas"),
          tooltip: $("#spatial-tooltip"),
          mode: "lisa",
        });
      }
      spatialMap.setBoundary(boundaryData);
      spatialMap.setSpatial(mapData, state.spatialView);
      renderSpatialDistribution(mapData);
      if (state.spatialView === "numeric") {
        const [low, high] = mapData.valueExtent;
        $("#spatial-legend").innerHTML = `
          <span>${escapeHtml(signed(low))}</span>
          <i class="continuous-legend" aria-hidden="true"></i>
          <span>0</span>
          <span>${escapeHtml(signed(high))}</span>
          <span class="legend-unit">${escapeHtml(mapData.unit)}</span>
        `;
      }
      loading.hidden = true;
    } catch (error) {
      loading.hidden = false;
      loading.textContent =
        location.protocol === "file:"
          ? "Interactive data requires a local web server. Run: python -m http.server 8000"
          : `Unable to load map data: ${error.message}`;
    }
  }

  function renderModels() {
    const comparison = state.modelComparison;
    const target = state.modelTarget;
    updateControl("model-comparison", comparison);
    updateControl("model-target", target);
    updateControl("model-metric", state.modelMetric);
    $("#importance-source-select").value = state.importanceSource;
    const selection = DATA.models.selections[`${comparison}:${target}`];
    const rows = selection.models;
    const metricSpec = {
      r2: {
        label: "R²",
        test: "testR2",
        spatial: "spatialCvR2",
        better: "high",
        format: (value) => value.toFixed(3),
      },
      rmse: {
        label: "RMSE",
        test: "testRmse",
        spatial: "spatialCvRmse",
        better: "low",
        format: (value) => compact(value),
      },
      mae: {
        label: "MAE",
        test: "testMae",
        spatial: "spatialCvMae",
        better: "low",
        format: (value) => compact(value),
      },
    }[state.modelMetric];
    const chooseBest = (field) =>
      rows.reduce((best, row) =>
        metricSpec.better === "high"
          ? row[field] > best[field]
            ? row
            : best
          : row[field] < best[field]
            ? row
            : best,
      );
    const bestTest = chooseBest(metricSpec.test);
    const bestSpatial = chooseBest(metricSpec.spatial);
    const extended = rows.find((row) => row.model === "B1_XGBoost");
    $("#model-kpis").innerHTML = [
      kpiCard(
        `Best holdout ${metricSpec.label}`,
        metricSpec.format(bestTest[metricSpec.test]),
        `${bestTest.model} · ${bestTest.specification}`,
        COLORS.navy,
      ),
      kpiCard(
        `Best spatial-CV ${metricSpec.label}`,
        metricSpec.format(bestSpatial[metricSpec.spatial]),
        `${bestSpatial.model} · ${bestSpatial.specification}`,
        COLORS.pollution,
      ),
      kpiCard(
        "Extended predictors",
        String(extended.nFeatures),
        "B1 XGBoost feature count",
        COLORS.exposure,
      ),
      kpiCard(
        "Held-out test cells",
        compact(extended.nTest, 1),
        `${compact(extended.nTrain, 1)} training cells`,
        COLORS.mobility,
      ),
    ].join("");

    $("#model-chart-title").textContent =
      `${metricSpec.label} by model specification`;
    const chartMax = Math.max(
      ...rows.flatMap((row) => [
        Math.abs(row[metricSpec.test]),
        Math.abs(row[metricSpec.spatial]),
      ]),
      1e-9,
    );
    $("#model-chart").innerHTML = rows
      .map(
        (row) => `
          <div class="model-row">
            <div class="model-row-label">
              <strong>${escapeHtml(row.model)}</strong>
              <span>${escapeHtml(row.family)} · ${escapeHtml(row.specification)}</span>
            </div>
            <div class="model-bars">
              <div class="model-bar test ${row[metricSpec.test] < 0 ? "is-negative" : ""}" aria-label="Random holdout ${metricSpec.label} ${metricSpec.format(row[metricSpec.test])}"><i style="width:${(Math.abs(row[metricSpec.test]) / chartMax) * 100}%"></i></div>
              <div class="model-bar spatial ${row[metricSpec.spatial] < 0 ? "is-negative" : ""}" aria-label="Spatial cross-validation ${metricSpec.label} ${metricSpec.format(row[metricSpec.spatial])}"><i style="width:${(Math.abs(row[metricSpec.spatial]) / chartMax) * 100}%"></i></div>
            </div>
            <strong>${metricSpec.format(row[metricSpec.test])} / ${metricSpec.format(row[metricSpec.spatial])}</strong>
          </div>
        `,
      )
      .join("");

    $("#model-insight").textContent =
      `${bestSpatial.model} (${bestSpatial.specification}) has the best spatial-CV ${metricSpec.label}. Negative spatial R² indicates performance below a fold-specific mean baseline and should not be interpreted as a negative correlation.`;

    $("#model-table").innerHTML = rows
      .map(
        (row) => `
          <tr>
            <td><strong>${escapeHtml(row.model)}</strong><br><span class="table-note">${escapeHtml(row.family)}</span></td>
            <td>${escapeHtml(row.specification)}</td>
            <td class="numeric">${row.testR2.toFixed(3)}</td>
            <td class="numeric">${row.spatialCvR2.toFixed(3)} ± ${row.spatialCvR2Std.toFixed(3)}</td>
            <td class="numeric">${compact(row.testRmse)}</td>
            <td class="numeric">${row.nFeatures}</td>
          </tr>
        `,
      )
      .join("");
    renderFeatureImportance(selection.importance);
    renderPredictionDiagnostics(selection.diagnostics.points);
  }

  function renderFeatureImportance(rows) {
    const source = state.importanceSource;
    const sorted = [...rows].sort((a, b) => b[source] - a[source]);
    const max = Math.max(...sorted.map((item) => item[source]), 1e-9);
    $("#importance-title").textContent =
      `${source === "xgboost" ? "XGBoost" : "Random forest"} feature importance`;
    $("#importance-feature-count").textContent =
      `${sorted.length} extended predictors`;
    $("#feature-importance-chart").innerHTML = sorted
      .map(
        (item, index) => `
          <div class="importance-row">
            <span>${String(index + 1).padStart(2, "0")}</span>
            <div>
              <div class="importance-head"><strong>${escapeHtml(item.label)}</strong><span>${item[source].toFixed(3)}</span></div>
              <div class="importance-track"><i style="width:${(item[source] / max) * 100}%"></i></div>
            </div>
          </div>
        `,
      )
      .join("");
  }

  function percentile(values, ratio) {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio)))];
  }

  function renderPredictionDiagnostics(points) {
    const finite = points.filter((item) =>
      item.slice(0, 3).every(Number.isFinite),
    );
    const combined = finite.flatMap((item) => [item[0], item[1]]);
    const low = percentile(combined, 0.02);
    const high = percentile(combined, 0.98);
    const width = 520;
    const height = 300;
    const margin = { top: 14, right: 18, bottom: 44, left: 54 };
    const x = (value) =>
      margin.left +
      ((Math.max(low, Math.min(high, value)) - low) /
        Math.max(high - low, 1e-9)) *
        (width - margin.left - margin.right);
    const y = (value) =>
      height -
      margin.bottom -
      ((Math.max(low, Math.min(high, value)) - low) /
        Math.max(high - low, 1e-9)) *
        (height - margin.top - margin.bottom);
    $("#prediction-scatter").innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Observed versus predicted scatter plot">
        <line x1="${x(low)}" y1="${y(low)}" x2="${x(high)}" y2="${y(high)}" stroke="#94a3b8" stroke-dasharray="5 4"></line>
        ${finite
          .map(
            (item) =>
              `<circle cx="${x(item[0])}" cy="${y(item[1])}" r="2.1" fill="#2563eb" fill-opacity="0.42"></circle>`,
          )
          .join("")}
        <line x1="${margin.left}" x2="${width - margin.right}" y1="${height - margin.bottom}" y2="${height - margin.bottom}" stroke="#cbd5e1"></line>
        <line x1="${margin.left}" x2="${margin.left}" y1="${margin.top}" y2="${height - margin.bottom}" stroke="#cbd5e1"></line>
        <text class="chart-axis" x="${margin.left}" y="${height - 19}">${escapeHtml(compact(low))}</text>
        <text class="chart-axis" x="${width - margin.right}" y="${height - 19}" text-anchor="end">${escapeHtml(compact(high))}</text>
        <text class="chart-axis" x="${margin.left + (width - margin.left - margin.right) / 2}" y="${height - 4}" text-anchor="middle">Observed</text>
        <text class="chart-axis" x="14" y="${height / 2}" text-anchor="middle" transform="rotate(-90 14 ${height / 2})">Predicted</text>
      </svg>
    `;

    const residuals = finite.map((item) => item[2]);
    const residualLow = percentile(residuals, 0.02);
    const residualHigh = percentile(residuals, 0.98);
    const bins = Array.from({ length: 26 }, () => 0);
    residuals.forEach((value) => {
      const clipped = Math.max(residualLow, Math.min(residualHigh, value));
      const ratio =
        (clipped - residualLow) /
        Math.max(residualHigh - residualLow, 1e-9);
      bins[Math.min(bins.length - 1, Math.floor(ratio * bins.length))] += 1;
    });
    const maxBin = Math.max(...bins, 1);
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const zeroX =
      margin.left +
      ((0 - residualLow) /
        Math.max(residualHigh - residualLow, 1e-9)) *
        plotWidth;
    $("#residual-histogram").innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Residual histogram">
        ${bins
          .map((count, index) => {
            const barWidth = plotWidth / bins.length;
            const barHeight = (count / maxBin) * plotHeight;
            return `<rect x="${margin.left + index * barWidth + 1}" y="${margin.top + plotHeight - barHeight}" width="${Math.max(1, barWidth - 2)}" height="${barHeight}" rx="1.5" fill="#0f766e" fill-opacity="0.75"></rect>`;
          })
          .join("")}
        ${zeroX >= margin.left && zeroX <= width - margin.right ? `<line x1="${zeroX}" x2="${zeroX}" y1="${margin.top}" y2="${margin.top + plotHeight}" stroke="#334155"></line>` : ""}
        <line x1="${margin.left}" x2="${width - margin.right}" y1="${height - margin.bottom}" y2="${height - margin.bottom}" stroke="#cbd5e1"></line>
        <text class="chart-axis" x="${margin.left}" y="${height - 18}">${escapeHtml(compact(residualLow))}</text>
        <text class="chart-axis" x="${width - margin.right}" y="${height - 18}" text-anchor="end">${escapeHtml(compact(residualHigh))}</text>
        <text class="chart-axis" x="${margin.left + plotWidth / 2}" y="${height - 3}" text-anchor="middle">Residual</text>
      </svg>
    `;
  }

  function renderShap() {
    const comparison = state.shapComparison;
    const target = state.shapTarget;
    updateControl("shap-comparison", comparison);
    updateControl("shap-target", target);
    const selection = DATA.shap.selections[`${comparison}:${target}`];
    const mappable = selection.mapFeatures.map((item) => item.feature);
    if (!state.shapFeature || !mappable.includes(state.shapFeature)) {
      state.shapFeature = mappable[0];
    }
    const selected = selection.features.find(
      (item) => item.feature === state.shapFeature,
    );
    const selectedRank =
      selection.features.findIndex(
        (item) => item.feature === state.shapFeature,
      ) + 1;
    const featureSelect = $("#shap-feature-select");
    featureSelect.innerHTML = selection.features
      .map(
        (item, index) =>
          `<option value="${escapeHtml(item.feature)}">${index + 1}. ${escapeHtml(item.label)}</option>`,
      )
      .join("");
    featureSelect.value = state.shapFeature;
    $("#shap-feature-count").textContent =
      `${selection.featureCount} predictors · select to explore`;

    $("#shap-kpis").innerHTML = [
      kpiCard(
        "Global importance rank",
        `#${selectedRank}`,
        `${selection.featureCount} predictors in the B1 model`,
        COLORS.navy,
      ),
      kpiCard(
        "Mean absolute SHAP",
        compact(selected.meanAbs),
        "Average contribution magnitude",
        COLORS.pollution,
      ),
      kpiCard(
        "Feature–SHAP Spearman correlation",
        selected.correlation == null
          ? "—"
          : selected.correlation.toFixed(3),
        "Directional association, not causality",
        COLORS.exposure,
      ),
      kpiCard(
        "Complete grid support",
        compact(selection.rows, 1),
        `${compact(selection.trainRows, 1)} train · ${compact(selection.testRows, 1)} test`,
        COLORS.mobility,
      ),
    ].join("");

    const max = Math.max(
      ...selection.features.map((item) => item.meanAbs),
      1,
    );
    $("#shap-ranking").innerHTML = selection.features
      .map(
        (item, index) => `
          <button type="button" class="shap-rank-button ${item.feature === state.shapFeature ? "is-active" : ""}" data-feature="${escapeHtml(item.feature)}" aria-pressed="${item.feature === state.shapFeature}">
            <span>${String(index + 1).padStart(2, "0")}</span>
            <span class="rank-main">
              <strong title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</strong>
              <span class="rank-track"><i style="width:${(item.meanAbs / max) * 100}%"></i></span>
            </span>
            <strong>${compact(item.meanAbs)}</strong>
          </button>
        `,
      )
      .join("");

    $("#shap-ranking").onclick = (event) => {
      const button = event.target.closest("button[data-feature]");
      if (!button) return;
      state.shapFeature = button.dataset.feature;
      renderShap();
    };

    $("#shap-map-title").textContent =
      `${selected.label} contribution surface`;
    $("#shap-beeswarm-title").textContent =
      `${DATA.meta.targets[target].label} · ${DATA.meta.comparisons[comparison].shortLabel}`;
    renderBeeswarm(selection.features);
    renderShapDependence(selected);

    const direction =
      selected.correlation == null
        ? "mixed"
        : selected.correlation >= 0.15
          ? "positive"
          : selected.correlation <= -0.15
            ? "negative"
            : "weak";
    $("#shap-direction-title").textContent =
      direction === "positive"
        ? `${selected.label} tends to raise predictions`
        : direction === "negative"
          ? `${selected.label} tends to lower predictions`
          : `${selected.label} has a heterogeneous relationship`;
    $("#shap-direction-copy").textContent =
      `The feature–SHAP Spearman correlation is ${selected.correlation == null ? "not estimable" : selected.correlation.toFixed(2)}. ${
        direction === "positive"
          ? "Higher feature values generally align with positive model contributions."
          : direction === "negative"
            ? "Higher feature values generally align with negative model contributions."
            : "Contribution direction varies across the observed feature range and location."
      }`;

    if (route() === "shap") renderShapMap();
  }

  function renderBeeswarm(features) {
    const root = $("#shap-beeswarm");
    const width = 980;
    const rowHeight = 44;
    const margin = { top: 24, right: 32, bottom: 36, left: 250 };
    const height = margin.top + margin.bottom + features.length * rowHeight;
    const allValues = features.flatMap((item) => [item.q05, item.q95]);
    const maxAbs = Math.max(...allValues.map((value) => Math.abs(value || 0)), 1);
    const x = (value) =>
      margin.left +
      ((value + maxAbs) / (2 * maxAbs)) * (width - margin.left - margin.right);
    const color = (normalized) => mixColor("#2563eb", "#d97706", normalized);
    root.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="beeswarm-title beeswarm-desc">
        <title id="beeswarm-title">SHAP feature contribution distributions</title>
        <desc id="beeswarm-desc">Sampled SHAP values for all retained predictors. Blue points indicate lower feature values and amber points indicate higher feature values.</desc>
        <line x1="${x(0)}" x2="${x(0)}" y1="${margin.top - 8}" y2="${height - margin.bottom}" stroke="#94a3b8" stroke-dasharray="3 3"></line>
        ${features
          .map((feature, featureIndex) => {
            const y = margin.top + featureIndex * rowHeight + rowHeight / 2;
            const dots = feature.points
              .map(([, value, normalized], pointIndex) => {
                const jitter = Math.sin(pointIndex * 2.399 + featureIndex) * 10;
                return `<circle cx="${x(Math.max(-maxAbs, Math.min(maxAbs, value)))}" cy="${y + jitter}" r="3.1" fill="${color(normalized)}" fill-opacity="0.72"></circle>`;
              })
              .join("");
            return `
              <line class="chart-grid" x1="${margin.left}" x2="${width - margin.right}" y1="${y}" y2="${y}"></line>
              <text x="${margin.left - 12}" y="${y + 4}" text-anchor="end" fill="#334155" font-size="11">${escapeHtml(feature.label)}</text>
              ${dots}
            `;
          })
          .join("")}
        <text class="chart-axis" x="${margin.left}" y="${height - 10}">Negative contribution</text>
        <text class="chart-axis" x="${width - margin.right}" y="${height - 10}" text-anchor="end">Positive contribution</text>
      </svg>
    `;
  }

  function renderShapDependence(feature) {
    const root = $("#shap-dependence");
    const points = feature.points.filter(
      (item) => Number.isFinite(item[0]) && Number.isFinite(item[1]),
    );
    const xValues = points.map((item) => item[0]);
    const yValues = points.map((item) => item[1]);
    const xLow = percentile(xValues, 0.02);
    const xHigh = percentile(xValues, 0.98);
    const yLow = percentile(yValues, 0.02);
    const yHigh = percentile(yValues, 0.98);
    const width = 980;
    const height = 340;
    const margin = { top: 18, right: 26, bottom: 52, left: 68 };
    const x = (value) =>
      margin.left +
      ((Math.max(xLow, Math.min(xHigh, value)) - xLow) /
        Math.max(xHigh - xLow, 1e-9)) *
        (width - margin.left - margin.right);
    const y = (value) =>
      height -
      margin.bottom -
      ((Math.max(yLow, Math.min(yHigh, value)) - yLow) /
        Math.max(yHigh - yLow, 1e-9)) *
        (height - margin.top - margin.bottom);
    $("#shap-dependence-title").textContent =
      `${feature.label}: feature value versus contribution`;
    $("#shap-correlation-note").textContent =
      `Spearman ρ ${feature.correlation == null ? "not estimable" : feature.correlation.toFixed(3)}`;
    root.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(feature.label)} feature value versus SHAP contribution">
        ${yLow <= 0 && yHigh >= 0 ? `<line x1="${margin.left}" x2="${width - margin.right}" y1="${y(0)}" y2="${y(0)}" stroke="#94a3b8" stroke-dasharray="4 4"></line>` : ""}
        ${points
          .map(
            ([featureValue, shapValue, normalized]) =>
              `<circle cx="${x(featureValue)}" cy="${y(shapValue)}" r="3.2" fill="${mixColor("#2563eb", "#d97706", normalized)}" fill-opacity="0.62"></circle>`,
          )
          .join("")}
        <line x1="${margin.left}" x2="${width - margin.right}" y1="${height - margin.bottom}" y2="${height - margin.bottom}" stroke="#cbd5e1"></line>
        <line x1="${margin.left}" x2="${margin.left}" y1="${margin.top}" y2="${height - margin.bottom}" stroke="#cbd5e1"></line>
        <text class="chart-axis" x="${margin.left}" y="${height - 25}">${escapeHtml(compact(xLow))}</text>
        <text class="chart-axis" x="${width - margin.right}" y="${height - 25}" text-anchor="end">${escapeHtml(compact(xHigh))}</text>
        <text class="chart-axis" x="${margin.left + (width - margin.left - margin.right) / 2}" y="${height - 6}" text-anchor="middle">${escapeHtml(feature.label)}</text>
        <text class="chart-axis" x="16" y="${height / 2}" text-anchor="middle" transform="rotate(-90 16 ${height / 2})">SHAP contribution</text>
      </svg>
    `;
  }

  async function renderShapMap() {
    const loading = $("#shap-loading");
    loading.hidden = false;
    loading.textContent = "Loading SHAP surface…";
    try {
      const key = `${state.shapComparison}:${state.shapTarget}`;
      const selection = DATA.shap.selections[key];
      const [mapData, boundaryData] = await Promise.all([
        getJson(selection.dataFile),
        getBoundary(),
      ]);
      if (!shapMap) {
        shapMap = new CanvasGeoMap({
          canvas: $("#shap-canvas"),
          tooltip: $("#shap-tooltip"),
          mode: "shap",
        });
      }
      shapMap.setBoundary(boundaryData);
      shapMap.setShap(mapData, state.shapFeature);
      loading.hidden = true;
    } catch (error) {
      loading.hidden = false;
      loading.textContent =
        location.protocol === "file:"
          ? "Interactive data requires a local web server. Run: python -m http.server 8000"
          : `Unable to load SHAP data: ${error.message}`;
    }
  }

  function mixColor(from, to, ratio) {
    const parse = (hex) => [
      Number.parseInt(hex.slice(1, 3), 16),
      Number.parseInt(hex.slice(3, 5), 16),
      Number.parseInt(hex.slice(5, 7), 16),
    ];
    const a = parse(from);
    const b = parse(to);
    const t = Math.max(0, Math.min(1, ratio));
    return `rgb(${a.map((value, index) => Math.round(value + (b[index] - value) * t)).join(",")})`;
  }

  function divergingColor(value, extent) {
    const [low, high] = extent;
    if (value < 0) {
      const ratio = Math.min(1, Math.abs(value) / Math.max(Math.abs(low), 1e-9));
      return mixColor("#f8fafc", "#2563eb", ratio);
    }
    const ratio = Math.min(1, value / Math.max(high, 1e-9));
    return mixColor("#f8fafc", "#d97706", ratio);
  }

  class CanvasGeoMap {
    constructor({ canvas, tooltip, mode }) {
      this.canvas = canvas;
      this.tooltip = tooltip;
      this.tooltip.classList.add("is-floating");
      document.body.appendChild(this.tooltip);
      this.mode = mode;
      this.ctx = canvas.getContext("2d", { alpha: false });
      this.zoom = 1;
      this.panX = 0;
      this.panY = 0;
      this.drag = null;
      this.boundary = null;
      this.data = null;
      this.activeFeature = null;
      this.hoverFrame = null;
      this.lastPointer = null;
      this.lastGestureWasDrag = false;
      this.projectedPoints = null;
      this.selectedPoint = null;
      this.selectionPinned = false;
      this.marker = document.createElement("span");
      this.marker.className = "map-cell-marker";
      this.marker.setAttribute("aria-hidden", "true");
      this.marker.hidden = true;
      canvas.parentElement.appendChild(this.marker);
      this.setupEvents();
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(canvas.parentElement);
      this.resize();
    }

    setupEvents() {
      this.canvas.addEventListener("pointerdown", (event) => {
        if (this.hoverFrame) {
          cancelAnimationFrame(this.hoverFrame);
          this.hoverFrame = null;
        }
        if (!this.selectionPinned) this.clearSelection();
        this.lastGestureWasDrag = false;
        this.canvas.setPointerCapture(event.pointerId);
        this.canvas.classList.add("is-dragging");
        this.drag = {
          x: event.clientX,
          y: event.clientY,
          panX: this.panX,
          panY: this.panY,
          moved: false,
        };
      });
      this.canvas.addEventListener("pointermove", (event) => {
        if (this.drag) {
          const deltaX = event.clientX - this.drag.x;
          const deltaY = event.clientY - this.drag.y;
          if (Math.hypot(deltaX, deltaY) > 3) this.drag.moved = true;
          this.panX = this.drag.panX + deltaX;
          this.panY = this.drag.panY + deltaY;
          this.tooltip.hidden = true;
          this.marker.hidden = true;
          this.draw();
          return;
        }
        if (this.selectionPinned) return;
        this.lastPointer = event;
        if (!this.hoverFrame) {
          this.hoverFrame = requestAnimationFrame(() => {
            this.hoverFrame = null;
            this.showNearest(this.lastPointer, false);
          });
        }
      });
      const stopDrag = (event, allowSelection) => {
        const drag = this.drag;
        this.drag = null;
        this.lastGestureWasDrag = Boolean(drag?.moved);
        this.canvas.classList.remove("is-dragging");
        if (allowSelection && drag && !drag.moved) {
          this.showNearest(event, true);
        } else if (drag?.moved && this.selectionPinned) {
          this.tooltip.hidden = false;
          this.updateSelectionPosition();
        }
      };
      this.canvas.addEventListener("pointerup", (event) => {
        stopDrag(event, true);
      });
      this.canvas.addEventListener("click", (event) => {
        if (this.lastGestureWasDrag) {
          this.lastGestureWasDrag = false;
          return;
        }
        this.showNearest(event, true);
      });
      this.canvas.addEventListener("pointercancel", () => {
        stopDrag(null, false);
      });
      this.canvas.addEventListener("pointerleave", () => {
        stopDrag(null, false);
        if (!this.selectionPinned) this.clearSelection();
      });
      this.canvas.addEventListener(
        "wheel",
        (event) => {
          event.preventDefault();
          const rect = this.canvas.getBoundingClientRect();
          const x = event.clientX - rect.left;
          const y = event.clientY - rect.top;
          this.zoomAt(event.deltaY < 0 ? 1.18 : 1 / 1.18, x, y);
        },
        { passive: false },
      );
      this.canvas.addEventListener("keydown", (event) => {
        const keyActions = {
          ArrowLeft: () => {
            this.panX += 24;
          },
          ArrowRight: () => {
            this.panX -= 24;
          },
          ArrowUp: () => {
            this.panY += 24;
          },
          ArrowDown: () => {
            this.panY -= 24;
          },
          "+": () => this.zoomAt(1.2, this.width / 2, this.height / 2),
          "=": () => this.zoomAt(1.2, this.width / 2, this.height / 2),
          "-": () => this.zoomAt(1 / 1.2, this.width / 2, this.height / 2),
          "0": () => this.reset(),
        };
        if (!keyActions[event.key]) return;
        event.preventDefault();
        keyActions[event.key]();
        this.draw();
      });
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      this.width = rect.width;
      this.height = rect.height;
      this.canvas.width = Math.round(rect.width * ratio);
      this.canvas.height = Math.round(rect.height * ratio);
      this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      this.draw();
    }

    reset() {
      this.zoom = 1;
      this.panX = 0;
      this.panY = 0;
      this.clearSelection();
      this.draw();
    }

    zoomAt(factor, x, y) {
      const oldZoom = this.zoom;
      const newZoom = Math.max(0.8, Math.min(8, oldZoom * factor));
      const centerX = this.width / 2;
      const centerY = this.height / 2;
      const ratio = newZoom / oldZoom;
      this.panX = x - centerX - (x - centerX - this.panX) * ratio;
      this.panY = y - centerY - (y - centerY - this.panY) * ratio;
      this.zoom = newZoom;
      this.draw();
    }

    setBoundary(data) {
      this.boundary = data;
      this.draw();
    }

    setLisa(data) {
      this.mode = "lisa";
      this.data = data;
      this.activeFeature = null;
      this.prepareProjectedPoints(data.points, data.stride);
      this.clearSelection();
      this.reset();
    }

    setSpatial(data, view) {
      this.mode = view === "lisa" ? "lisa" : "numeric";
      this.data = data;
      this.activeFeature = null;
      this.prepareProjectedPoints(data.points, data.stride);
      this.clearSelection();
      this.reset();
    }

    setShap(data, feature) {
      this.mode = "shap";
      this.data = data;
      this.activeFeature = data.features.find(
        (item) => item.feature === feature,
      );
      this.prepareProjectedPoints(data.coords, data.coordStride);
      this.clearSelection();
      this.reset();
    }

    prepareProjectedPoints(values, stride) {
      const pointCount = Math.floor(values.length / stride);
      const projected = new Float64Array(pointCount * 2);
      for (
        let source = 0, target = 0;
        source < values.length;
        source += stride, target += 2
      ) {
        const [x, y] = CHINA_ALBERS(values[source], values[source + 1]);
        projected[target] = x;
        projected[target + 1] = y;
      }
      this.projectedPoints = projected;
    }

    project(lon, lat) {
      return this.projectProjected(...CHINA_ALBERS(lon, lat));
    }

    projectProjected(projectedX, projectedY) {
      const [minX, minY, maxX, maxY] = CHINA_PROJECTED_BOUNDS;
      const pad = 18;
      const baseScale = Math.min(
        (this.width - pad * 2) / (maxX - minX),
        (this.height - pad * 2) / (maxY - minY),
      );
      const plotWidth = (maxX - minX) * baseScale;
      const plotHeight = (maxY - minY) * baseScale;
      const baseX =
        (this.width - plotWidth) / 2 + (projectedX - minX) * baseScale;
      const baseY =
        (this.height - plotHeight) / 2 + (maxY - projectedY) * baseScale;
      return [
        this.width / 2 + (baseX - this.width / 2) * this.zoom + this.panX,
        this.height / 2 + (baseY - this.height / 2) * this.zoom + this.panY,
      ];
    }

    drawBoundary(fill = true) {
      if (!this.boundary) return;
      const features = this.boundary.features || [];
      this.ctx.save();
      this.ctx.beginPath();
      const drawRing = (ring) => {
        ring.forEach(([lon, lat], index) => {
          const [x, y] = this.project(lon, lat);
          if (index === 0) this.ctx.moveTo(x, y);
          else this.ctx.lineTo(x, y);
        });
        this.ctx.closePath();
      };
      features.forEach((feature) => {
        const geometry = feature.geometry;
        const polygons =
          geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
        polygons.forEach((polygon) => polygon.forEach(drawRing));
      });
      if (fill) {
        this.ctx.fillStyle = "#f8fafc";
        this.ctx.fill("evenodd");
      }
      this.ctx.strokeStyle = "#94a3b8";
      this.ctx.lineWidth = 0.85;
      this.ctx.stroke();
      this.ctx.restore();
    }

    draw() {
      if (!this.width || !this.height) return;
      this.ctx.save();
      this.ctx.clearRect(0, 0, this.width, this.height);
      this.ctx.fillStyle = "#edf2f6";
      this.ctx.fillRect(0, 0, this.width, this.height);
      this.drawGraticule();
      this.drawBoundary(true);
      if (this.data) {
        if (this.mode === "lisa") this.drawLisa();
        else if (this.mode === "numeric") this.drawNumeric();
        else this.drawShap();
      }
      this.drawBoundary(false);
      this.ctx.restore();
      this.updateSelectionPosition();
    }

    drawGraticule() {
      this.ctx.save();
      this.ctx.strokeStyle = "#d9e2e8";
      this.ctx.lineWidth = 0.5;
      this.ctx.setLineDash([2, 5]);
      for (let lon = 80; lon <= 130; lon += 10) {
        this.ctx.beginPath();
        for (let lat = 18, index = 0; lat <= 54; lat += 1, index += 1) {
          const point = this.project(lon, lat);
          if (index === 0) this.ctx.moveTo(...point);
          else this.ctx.lineTo(...point);
        }
        this.ctx.stroke();
      }
      for (let lat = 20; lat <= 50; lat += 10) {
        this.ctx.beginPath();
        for (let lon = 73, index = 0; lon <= 135; lon += 1, index += 1) {
          const point = this.project(lon, lat);
          if (index === 0) this.ctx.moveTo(...point);
          else this.ctx.lineTo(...point);
        }
        this.ctx.stroke();
      }
      this.ctx.restore();
    }

    drawLisa() {
      const points = this.data.points;
      const stride = this.data.stride;
      const size = Math.max(1, Math.min(4.5, 1.15 * this.zoom));
      const order = [5, 0, 2, 1, 3, 4];
      this.ctx.save();
      for (const cluster of order) {
        this.ctx.fillStyle = CLUSTER_COLOR.get(cluster) || "#e2e8f0";
        this.ctx.globalAlpha = cluster === 5 ? 0.32 : cluster === 0 ? 0.48 : 0.9;
        for (
          let index = 0, point = 0;
          index < points.length;
          index += stride, point += 1
        ) {
          if (points[index + 2] !== cluster) continue;
          const [x, y] = this.projectProjected(
            this.projectedPoints[point * 2],
            this.projectedPoints[point * 2 + 1],
          );
          if (x < -5 || y < -5 || x > this.width + 5 || y > this.height + 5) {
            continue;
          }
          this.ctx.fillRect(x - size / 2, y - size / 2, size, size);
        }
      }
      this.ctx.restore();
    }

    drawNumeric() {
      const points = this.data.points;
      const stride = this.data.stride;
      const size = Math.max(1.1, Math.min(4.8, 1.35 * this.zoom));
      this.ctx.save();
      this.ctx.globalAlpha = 0.86;
      for (
        let index = 0, point = 0;
        index < points.length;
        index += stride, point += 1
      ) {
        const [x, y] = this.projectProjected(
          this.projectedPoints[point * 2],
          this.projectedPoints[point * 2 + 1],
        );
        if (x < -5 || y < -5 || x > this.width + 5 || y > this.height + 5) {
          continue;
        }
        this.ctx.fillStyle = divergingColor(
          points[index + 3],
          this.data.valueExtent,
        );
        this.ctx.fillRect(x - size / 2, y - size / 2, size, size);
      }
      this.ctx.restore();
    }

    drawShap() {
      if (!this.activeFeature) return;
      const coords = this.data.coords;
      const values = this.activeFeature.values;
      const size = Math.max(1.1, Math.min(4.8, 1.35 * this.zoom));
      this.ctx.save();
      this.ctx.globalAlpha = 0.84;
      for (let index = 0, point = 0; index < coords.length; index += 2, point += 1) {
        const [x, y] = this.projectProjected(
          this.projectedPoints[point * 2],
          this.projectedPoints[point * 2 + 1],
        );
        if (x < -5 || y < -5 || x > this.width + 5 || y > this.height + 5) {
          continue;
        }
        this.ctx.fillStyle = divergingColor(
          values[point],
          this.activeFeature.extent,
        );
        this.ctx.fillRect(x - size / 2, y - size / 2, size, size);
      }
      this.ctx.restore();
    }

    showNearest(event, pin = false) {
      if (!event || !this.data || this.drag) return;
      if (this.selectionPinned && !pin) return;
      const rect = this.canvas.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      let nearest = null;
      let bestDistance = 11 * 11;

      if (this.mode === "lisa" || this.mode === "numeric") {
        const points = this.data.points;
        const stride = this.data.stride;
        for (
          let index = 0, point = 0;
          index < points.length;
          index += stride, point += 1
        ) {
          const projectedX = this.projectedPoints[point * 2];
          const projectedY = this.projectedPoints[point * 2 + 1];
          const [x, y] = this.projectProjected(projectedX, projectedY);
          const distance = (x - pointerX) ** 2 + (y - pointerY) ** 2;
          if (distance < bestDistance) {
            bestDistance = distance;
            nearest = {
              x,
              y,
              lon: points[index],
              lat: points[index + 1],
              code: points[index + 2],
              value: points[index + 3],
              pValue: points[index + 4],
              provinceIndex: points[index + 5],
              projectedX,
              projectedY,
            };
          }
        }
      } else if (this.activeFeature) {
        const coords = this.data.coords;
        const values = this.activeFeature.values;
        for (let index = 0, point = 0; index < coords.length; index += 2, point += 1) {
          const projectedX = this.projectedPoints[point * 2];
          const projectedY = this.projectedPoints[point * 2 + 1];
          const [x, y] = this.projectProjected(projectedX, projectedY);
          const distance = (x - pointerX) ** 2 + (y - pointerY) ** 2;
          if (distance < bestDistance) {
            bestDistance = distance;
            nearest = {
              x,
              y,
              lon: coords[index],
              lat: coords[index + 1],
              value: values[point],
              provinceIndex: this.data.provinces?.[point] ?? -1,
              projectedX,
              projectedY,
            };
          }
        }
      }

      if (!nearest) {
        if (pin) this.clearSelection();
        else if (!this.selectionPinned) this.clearSelection();
        return;
      }
      this.selectedPoint = nearest;
      this.selectionPinned = pin;
      this.marker.hidden = false;
      this.marker.classList.toggle("is-pinned", pin);
      const province =
        DATA.spatial.provinceNames[nearest.provinceIndex] || "Outside assigned provinces";
      if (this.mode === "lisa") {
        this.tooltip.innerHTML = `
          <strong>${escapeHtml(CLUSTER_LABEL.get(nearest.code) || "No data")}</strong>
          <span>${escapeHtml(province)} · ${nearest.lat.toFixed(2)}°N, ${nearest.lon.toFixed(2)}°E</span>
          <span>Change: ${signed(nearest.value)}</span>
          <span>Local p-value: ${Number.isFinite(nearest.pValue) ? nearest.pValue.toFixed(3) : "—"}</span>
        `;
      } else if (this.mode === "numeric") {
        this.tooltip.innerHTML = `
          <strong>${escapeHtml(DATA.meta.spatialLayers[this.data.target].label)}</strong>
          <span>${escapeHtml(province)} · ${nearest.lat.toFixed(2)}°N, ${nearest.lon.toFixed(2)}°E</span>
          <span>Change: ${signed(nearest.value)} ${escapeHtml(this.data.unit)}</span>
        `;
      } else {
        this.tooltip.innerHTML = `
          <strong>${escapeHtml(this.activeFeature.label)}</strong>
          <span>${escapeHtml(province)} · ${nearest.lat.toFixed(2)}°N, ${nearest.lon.toFixed(2)}°E</span>
          <span>SHAP: ${signed(nearest.value)}</span>
        `;
      }
      this.tooltip.hidden = false;
      this.updateSelectionPosition();
    }

    updateSelectionPosition() {
      if (!this.selectedPoint) {
        this.marker.hidden = true;
        this.tooltip.hidden = true;
        return;
      }
      const [x, y] = this.projectProjected(
        this.selectedPoint.projectedX,
        this.selectedPoint.projectedY,
      );
      const outside =
        x < -12 || y < -12 || x > this.width + 12 || y > this.height + 12;
      if (outside) {
        this.marker.hidden = true;
        this.tooltip.hidden = true;
        return;
      }
      this.marker.hidden = false;
      this.marker.style.left = `${x}px`;
      this.marker.style.top = `${y}px`;
      const canvasRect = this.canvas.getBoundingClientRect();
      const clientX = canvasRect.left + x;
      const clientY = canvasRect.top + y;
      const outsideViewport =
        clientX < 0 ||
        clientY < 0 ||
        clientX > window.innerWidth ||
        clientY > window.innerHeight;
      if (outsideViewport) {
        this.tooltip.hidden = true;
        return;
      }
      this.tooltip.hidden = false;
      positionFloatingTooltip(this.tooltip, clientX, clientY, "right");
    }

    clearSelection() {
      this.selectedPoint = null;
      this.selectionPinned = false;
      this.marker.hidden = true;
      this.marker.classList.remove("is-pinned");
      this.tooltip.hidden = true;
    }
  }

  function setupMapControls() {
    $$("[data-map][data-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const map = button.dataset.map === "spatial" ? spatialMap : shapMap;
        if (!map) return;
        const action = button.dataset.action;
        if (action === "reset") map.reset();
        else {
          map.zoomAt(
            action === "zoom-in" ? 1.25 : 1 / 1.25,
            map.width / 2,
            map.height / 2,
          );
        }
      });
    });

    $$("[data-expand-card]").forEach((button) => {
      button.addEventListener("click", () => {
        const card = document.getElementById(button.dataset.expandCard);
        const expanded = card.classList.toggle("is-expanded");
        document.body.style.overflow = expanded ? "hidden" : "";
        button.setAttribute("aria-label", expanded ? "Exit full-screen map" : "Toggle full-screen map");
        window.setTimeout(() => {
          if (card.id === "spatial-map-card") spatialMap?.resize();
          else shapMap?.resize();
        }, 40);
      });
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      const expanded = $(".card.is-expanded");
      if (!expanded) return;
      expanded.classList.remove("is-expanded");
      document.body.style.overflow = "";
      window.setTimeout(() => {
        spatialMap?.resize();
        shapMap?.resize();
      }, 40);
    });
  }

  function setupFloatingChrome() {
    const topbar = $(".topbar");
    if (!topbar) return;

    let frame = null;
    const update = () => {
      frame = null;
      topbar.classList.toggle("is-scrolled", window.scrollY > 8);
    };

    window.addEventListener(
      "scroll",
      () => {
        if (frame) return;
        frame = requestAnimationFrame(update);
      },
      { passive: true },
    );
    update();
  }

  function init() {
    setupSegmentedControls();
    setupMapControls();
    setupFloatingChrome();
    renderOverview();
    renderSpatial();
    renderModels();
    renderShap();
    renderRoute();
    window.addEventListener("hashchange", renderRoute);
    window.addEventListener("resize", () => {
      spatialMap?.resize();
      shapMap?.resize();
    });
    window.addEventListener(
      "scroll",
      () => {
        if (trendTooltip) trendTooltip.hidden = true;
        spatialMap?.updateSelectionPosition();
        shapMap?.updateSelectionPosition();
      },
      { passive: true },
    );
  }

  init();
})();
