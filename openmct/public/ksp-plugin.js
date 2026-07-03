/* KSP2 MCC telemetry adapter for Open MCT.
 *
 * Помимо точек телеметрии борта, плагин создаёт ГОТОВЫЕ сгруппированные
 * дашборды (Display Layout) с графиками (Overlay Plot), приборами (Gauge)
 * и цифровыми табло — сразу собранные по фазам полёта, чтобы не собирать
 * экраны вручную. Всё это — штатные объекты Open MCT, отдаваемые нашим
 * object/composition-провайдером; данные идут через WebSocket backend'а.
 */
(function () {
  const NS = "ksp";

  const HOST = location.hostname || "localhost";
  const WS_URL = `ws://${HOST}:8000/ws`;
  const HIST_URL = `http://${HOST}:8000/api/telemetry/history`;

  // measurement key -> как достать из telemetry `data`, и поле истории (если есть)
  const MEASUREMENTS = [
    { key: "alt", name: "Высота H", unit: "м", get: (d) => d.vessel?.alt_sealevel_m, hist: "alt_m" },
    { key: "apoapsis", name: "Апогей Ha", unit: "м", get: (d) => d.vessel?.orbit?.apoapsis_m, hist: "apoapsis_m" },
    { key: "periapsis", name: "Перигей Hp", unit: "м", get: (d) => d.vessel?.orbit?.periapsis_m, hist: "periapsis_m" },
    { key: "speed", name: "Скорость V", unit: "м/с", get: (d) => d.vessel?.surface_speed_ms, hist: "surface_speed_ms" },
    { key: "vspeed", name: "Верт. скорость", unit: "м/с", get: (d) => d.vessel?.vertical_speed_ms, hist: "vertical_speed_ms" },
    { key: "throttle", name: "РРД, тяга", unit: "%", get: (d) => (d.vessel?.throttle != null ? d.vessel.throttle * 100 : undefined), hist: "throttle" },
    { key: "mass", name: "Масса M", unit: "т", get: (d) => d.vessel?.mass_t, hist: "mass_t" },
    { key: "stagefuel", name: "Топливо ступени", unit: "%", get: (d) => d.vessel?.fuel?.stage_pct },
    { key: "gforce", name: "Перегрузка n", unit: "g", get: (d) => d.vessel?.dynamics?.g_force },
    { key: "q", name: "Скор. напор q", unit: "кПа", get: (d) => d.vessel?.dynamics?.dynamic_pressure_kpa },
    { key: "mach", name: "Число М", unit: "", get: (d) => d.vessel?.dynamics?.mach },
    { key: "theta", name: "Угол θ", unit: "°", get: (d) => d.vessel?.flight_path_angle_deg },
    { key: "heading", name: "Курс", unit: "°", get: (d) => d.vessel?.heading_deg },
    { key: "incl", name: "Наклонение i", unit: "°", get: (d) => d.vessel?.orbit?.inclination_deg },
    // сближение / стыковка
    { key: "tgt_dist", name: "Дальность до цели D", unit: "м", get: (d) => d.vessel?.target?.distance_m },
    { key: "tgt_vrel", name: "Скорость сближения", unit: "м/с", get: (d) => d.vessel?.target?.rel_speed_ms },
    { key: "tgt_fwd", name: "Ось X (вдоль)", unit: "м", get: (d) => d.vessel?.target?.offset_fwd_m },
    { key: "tgt_right", name: "Промах Y (вбок)", unit: "м", get: (d) => d.vessel?.target?.offset_right_m },
    { key: "tgt_up", name: "Промах Z (верт.)", unit: "м", get: (d) => d.vessel?.target?.offset_up_m },
  ];
  const BY_KEY = Object.fromEntries(MEASUREMENTS.map((m) => [m.key, m]));

  // ------------------------------------------------------------ identifiers
  const idOf = (key) => ({ namespace: NS, key });
  function uuid() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  // Реестр всех объектов Open MCT, отдаваемых нашим провайдером.
  const OBJECTS = {};

  function valuesFor(m) {
    return [
      { key: "utc", name: "Время", format: "utc.timestamp", source: "utc", hints: { domain: 1 } },
      { key: "value", name: m.name, unit: m.unit, hints: { range: 1 } },
    ];
  }

  // точки телеметрии
  MEASUREMENTS.forEach((m) => {
    OBJECTS[m.key] = {
      name: m.name,
      type: "ksp.telemetry",
      telemetry: { values: valuesFor(m) },
      location: `${NS}:params`,
    };
  });

  // ------------------------------------------------------- строители объектов
  function plot(key, name, members, location) {
    OBJECTS[key] = {
      name,
      type: "telemetry.plot.overlay",
      composition: members.map(idOf),
      configuration: { series: members.map((k) => ({ identifier: idOf(k) })) },
      location,
    };
    return key;
  }

  function gauge(key, name, member, o, location) {
    OBJECTS[key] = {
      name,
      type: "gauge",
      composition: [idOf(member)],
      configuration: {
        gaugeController: {
          gaugeType: o.type || "dial-filled",
          isDisplayMinMax: true,
          isDisplayCurVal: true,
          isDisplayUnits: true,
          isUseTelemetryLimits: false,
          min: o.min,
          max: o.max,
          limitLow: o.limitLow != null ? o.limitLow : o.min,
          limitHigh: o.limitHigh != null ? o.limitHigh : o.max,
          precision: o.precision != null ? o.precision : 0,
        },
      },
      location,
    };
    return key;
  }

  // элементы Display Layout (сетка 10×10 px)
  function subobj(key, x, y, w, h) {
    return { type: "subobject-view", id: uuid(), identifier: idOf(key), x, y, width: w, height: h, hasFrame: true, fontSize: "default", font: "default" };
  }
  function tile(key, x, y, w, h) {
    return { type: "telemetry-view", id: uuid(), identifier: idOf(key), x, y, width: w, height: h, displayMode: "all", value: "value", stroke: "", fill: "", color: "", fontSize: "default", font: "default" };
  }

  function layout(key, name, items, location) {
    // composition = уникальные идентификаторы всех элементов
    const seen = new Set();
    const composition = [];
    items.forEach((it) => {
      const ks = `${it.identifier.namespace}:${it.identifier.key}`;
      if (!seen.has(ks)) {
        seen.add(ks);
        composition.push(it.identifier);
      }
    });
    OBJECTS[key] = {
      name,
      type: "layout",
      composition,
      configuration: { items, layoutGrid: [10, 10] },
      location,
    };
    return key;
  }

  // --------------------------------------------------------------- графики
  plot("plot_alt", "Высота и орбита", ["alt", "apoapsis", "periapsis"], `${NS}:dash_ascent`);
  plot("plot_speed", "Скорость", ["speed", "vspeed"], `${NS}:dash_ascent`);
  plot("plot_orbit", "Апогей / перигей", ["apoapsis", "periapsis", "alt"], `${NS}:dash_orbit`);
  plot("plot_du", "Тяга РРД", ["throttle"], `${NS}:dash_du`);
  plot("plot_dock", "Сближение: дальность / скорость", ["tgt_dist", "tgt_vrel"], `${NS}:dash_dock`);

  // --------------------------------------------------------------- приборы
  gauge("g_throttle", "РРД (тяга)", "throttle", { min: 0, max: 100, limitLow: 0, limitHigh: 100, type: "meter-vertical" }, `${NS}:dash_ascent`);
  gauge("g_gforce", "Перегрузка n", "gforce", { min: 0, max: 10, limitLow: 0, limitHigh: 6, precision: 1 }, `${NS}:dash_ascent`);
  gauge("g_q", "Скор. напор q", "q", { min: 0, max: 50, limitLow: 0, limitHigh: 40 }, `${NS}:dash_ascent`);
  gauge("g_fuel", "Топливо ступени", "stagefuel", { min: 0, max: 100, limitLow: 10, limitHigh: 100 }, `${NS}:dash_du`);

  // --------------------------------------------------------------- дашборды
  layout("dash_ascent", "01 · Выведение", [
    subobj("plot_alt", 2, 2, 46, 30),
    subobj("plot_speed", 50, 2, 46, 30),
    subobj("g_throttle", 2, 34, 20, 26),
    subobj("g_gforce", 24, 34, 20, 26),
    subobj("g_q", 46, 34, 20, 26),
    tile("alt", 68, 34, 28, 6),
    tile("speed", 68, 41, 28, 6),
    tile("gforce", 68, 48, 28, 6),
    tile("mass", 68, 55, 28, 6),
  ], `${NS}:spacecraft`);

  layout("dash_orbit", "02 · Орбита", [
    subobj("plot_orbit", 2, 2, 60, 42),
    tile("apoapsis", 64, 2, 32, 8),
    tile("periapsis", 64, 11, 32, 8),
    tile("incl", 64, 20, 32, 8),
    tile("speed", 64, 29, 32, 8),
    tile("theta", 64, 38, 32, 8),
  ], `${NS}:spacecraft`);

  layout("dash_du", "03 · Двигательная установка и топливо", [
    subobj("g_throttle", 2, 2, 22, 34),
    subobj("g_fuel", 26, 2, 22, 34),
    subobj("plot_du", 2, 38, 46, 22),
    tile("mass", 52, 2, 44, 8),
    tile("throttle", 52, 11, 44, 8),
    tile("stagefuel", 52, 20, 44, 8),
  ], `${NS}:spacecraft`);

  layout("dash_dock", "04 · Сближение и стыковка", [
    tile("tgt_dist", 2, 2, 30, 11),
    tile("tgt_vrel", 2, 14, 30, 11),
    tile("tgt_fwd", 34, 2, 30, 11),
    tile("tgt_right", 34, 14, 30, 11),
    tile("tgt_up", 66, 2, 30, 11),
    subobj("plot_dock", 2, 26, 62, 32),
  ], `${NS}:spacecraft`);

  // ------------------------------------------------------------ контейнеры
  OBJECTS["params"] = {
    name: "Параметры телеметрии",
    type: "folder",
    location: `${NS}:spacecraft`,
    composition: MEASUREMENTS.map((m) => idOf(m.key)),
  };

  OBJECTS["spacecraft"] = {
    name: "Борт KSP2",
    type: "folder",
    location: "ROOT",
    composition: [
      idOf("dash_ascent"),
      idOf("dash_orbit"),
      idOf("dash_du"),
      idOf("dash_dock"),
      idOf("params"),
    ],
  };

  // ---- shared WebSocket to the backend, fan-out to subscribers ----
  const subscribers = {}; // key -> Set(callback)
  let ws = null;
  function connect() {
    ws = new WebSocket(WS_URL);
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type !== "telemetry") return;
      const d = msg.data || {};
      const t = Date.now();
      for (const m of MEASUREMENTS) {
        const set = subscribers[m.key];
        if (!set || set.size === 0) continue;
        const v = m.get(d);
        if (v == null || Number.isNaN(v)) continue;
        const datum = { id: m.key, utc: t, value: v };
        set.forEach((cb) => cb(datum));
      }
    };
    ws.onclose = () => setTimeout(connect, 2000);
    ws.onerror = () => ws.close();
  }
  connect();

  function KSPPlugin() {
    return function install(openmct) {
      openmct.objects.addRoot(idOf("spacecraft"));

      openmct.objects.addProvider(NS, {
        get(identifier) {
          const o = OBJECTS[identifier.key];
          if (!o) return Promise.resolve(undefined);
          return Promise.resolve(Object.assign({ identifier }, o));
        },
      });

      // Composition: у контейнеров/дашбордов/графиков есть массив composition.
      openmct.composition.addProvider({
        appliesTo(domainObject) {
          return domainObject.identifier.namespace === NS && Array.isArray(domainObject.composition);
        },
        load(domainObject) {
          return Promise.resolve(domainObject.composition.map((i) => ({ namespace: i.namespace, key: i.key })));
        },
      });

      openmct.types.addType("ksp.telemetry", {
        name: "Параметр телеметрии",
        description: "Точка телеметрии борта KSP2",
        cssClass: "icon-telemetry",
      });

      openmct.telemetry.addProvider(realtimeProvider());
      openmct.telemetry.addProvider(historicalProvider());
    };
  }

  function realtimeProvider() {
    return {
      supportsSubscribe(domainObject) {
        return domainObject.type === "ksp.telemetry";
      },
      subscribe(domainObject, callback) {
        const key = domainObject.identifier.key;
        (subscribers[key] = subscribers[key] || new Set()).add(callback);
        return () => subscribers[key] && subscribers[key].delete(callback);
      },
    };
  }

  function historicalProvider() {
    return {
      supportsRequest(domainObject) {
        return domainObject.type === "ksp.telemetry";
      },
      async request(domainObject, options) {
        const m = BY_KEY[domainObject.identifier.key];
        if (!m || !m.hist) return [];
        try {
          const r = await fetch(`${HIST_URL}?seconds=1800&max_points=600`);
          const points = await r.json();
          return points
            .map((p) => ({ id: m.key, utc: Math.round(p.ts * 1000), value: p[m.hist] }))
            .filter((p) => p.value != null && !Number.isNaN(p.value));
        } catch {
          return [];
        }
      },
    };
  }

  window.KSPPlugin = KSPPlugin;
})();
