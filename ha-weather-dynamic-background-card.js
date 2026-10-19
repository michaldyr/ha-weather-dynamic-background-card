/*
 * HA Weather Dynamic Background
 * https://github.com/michaldyr/ha-weather-dynamic-background-card
 *
 * A living, weather-aware dashboard background.
 * The sky follows real conditions (sun elevation and azimuth, weather, cloud cover, wind,
 * moon phase); the Home Assistant light/dark theme only corrects it so cards stay readable.
 * The card itself is invisible on the dashboard; it shows a settings panel in edit mode.
 */

const VERSION = "1.6.0";
const TAG = "ha-weather-dynamic-background-card";
const DEVICE_KEY = "ha-weather-dynamic-background-card:device";

const DEFAULTS = {
  weather_entity: "",
  sun_entity: "sun.sun",
  precipitation_entity: "",
  animations: true,
  intensity: 100,
  hysteresis: 10,
  dark_dim: 40,
  light_lift: 10,
  lightning_flash: true,
  show_moon: true,
  show_stars: true,
  show_panel: false,
  pm25_entity: "",
  kp_entity: "",
  warning_entity: "",
  sun_azimuth: true,
  show_rainbow: true,
  show_frost: true,
  show_shooting_stars: true,
};

const DEVICE_DEFAULTS = { enabled: true, animations: "auto", quality: "auto" };

/* ------------------------------------------------------------------ utils */

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mixRgb = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const mixPal = (p, q, t) => p.map((c, i) => mixRgb(c, q[i], t));
const rgb = (c, a) =>
  a === undefined
    ? `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`
    : `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
const luminance = (c) => {
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
const num = (v) => {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
};
const mulberry = (seed) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/* --------------------------------------------------------------- palettes */
// Four stops each: top, upper middle, lower middle, bottom.

const CLEAR_KEYS = [
  [-90, ["#050b1e", "#0a1430", "#111f42", "#1a2c55"]],
  [-18, ["#08122b", "#0f1d3e", "#172a52", "#223a68"]],
  [-12, ["#0d1a3d", "#162852", "#223868", "#334b7e"]],
  [-6, ["#17285a", "#2c3f78", "#5a5b8c", "#9a7591"]],
  [-2, ["#26407e", "#4e5e98", "#bb7f8b", "#f2a06f"]],
  [2, ["#2f58a8", "#5f82c4", "#d1a296", "#f6c08a"]],
  [6, ["#2f62bd", "#5689d2", "#9db8dc", "#e9d2b4"]],
  [12, ["#2a63c6", "#4384da", "#72a8e6", "#a9cdf1"]],
  [30, ["#2560c8", "#3b7edb", "#5f9de8", "#8cc0f2"]],
  [90, ["#235cc4", "#387ad8", "#5b98e6", "#87bbf0"]],
].map(([e, p]) => [e, p.map(hex)]);

const WEATHER_PAL = {
  overcast: {
    day: ["#6f7782", "#646c78", "#5d6570", "#575f6a"],
    night: ["#121a28", "#192334", "#212d40", "#2a384d"],
  },
  rain: {
    day: ["#4b525c", "#454c56", "#40474f", "#3b424a"],
    night: ["#0d131c", "#141b26", "#1b2431", "#232d3b"],
  },
  storm: {
    day: ["#232a35", "#2e3643", "#3c4553", "#4d5663"],
    night: ["#080b12", "#0e131c", "#151b26", "#1c2330"],
  },
  snow: {
    day: ["#6d82a0", "#8699b2", "#a6b5c8", "#c8d3df"],
    night: ["#18223a", "#212d47", "#2d3a56", "#3b4966"],
  },
  fog: {
    day: ["#8a96a4", "#9da8b4", "#b1bac4", "#c5ccd4"],
    night: ["#1b212b", "#232a35", "#2c3440", "#363e4b"],
  },
};
for (const k of Object.keys(WEATHER_PAL)) {
  WEATHER_PAL[k].day = WEATHER_PAL[k].day.map(hex);
  WEATHER_PAL[k].night = WEATHER_PAL[k].night.map(hex);
}

const CONDITIONS = {
  sunny: { cov: 5 },
  "clear-night": { cov: 5 },
  partlycloudy: { cov: 45 },
  cloudy: { cov: 92, pal: "overcast" },
  fog: { cov: 80, pal: "fog", fog: 1 },
  rainy: { cov: 90, pal: "rain", rain: 0.55 },
  pouring: { cov: 100, pal: "rain", rain: 1, k: 1 },
  lightning: { cov: 90, pal: "storm", storm: 1 },
  "lightning-rainy": { cov: 100, pal: "storm", rain: 0.85, storm: 1, k: 1 },
  snowy: { cov: 90, pal: "snow", snow: 0.6 },
  "snowy-rainy": { cov: 95, pal: "rain", rain: 0.35, snow: 0.35 },
  hail: { cov: 95, pal: "storm", hail: 0.7 },
  windy: { cov: 30, wind: 40 },
  "windy-variant": { cov: 65, wind: 40 },
  exceptional: { cov: 75, pal: "overcast" },
};

const REPO_URL = "https://github.com/michaldyr/ha-weather-dynamic-background-card";

const STRINGS = {
  en: {
    name: "HA Weather Dynamic Background",
    description: "Living dashboard background that follows the weather, time of day and moon phase.",
    cond: {
      sunny: "Sunny",
      "clear-night": "Clear night",
      partlycloudy: "Partly cloudy",
      cloudy: "Cloudy",
      fog: "Fog",
      rainy: "Rain",
      pouring: "Pouring",
      lightning: "Thunderstorm",
      "lightning-rainy": "Thunderstorm with rain",
      snowy: "Snow",
      "snowy-rainy": "Sleet",
      hail: "Hail",
      windy: "Windy",
      "windy-variant": "Windy and cloudy",
      exceptional: "Exceptional",
    },
    labels: {
      show_panel: "Show panel on the dashboard",
      weather_entity: "Weather entity",
      sun_entity: "Sun entity",
      precipitation_entity: "Precipitation rate (optional, mm/h)",
      pm25_entity: "PM2.5 sensor (optional) – smog",
      kp_entity: "Kp index (optional) – aurora",
      warning_entity: "Weather warnings (optional)",
      animations: "Animations",
      lightning_flash: "Lightning flashes",
      show_moon: "Moon",
      show_stars: "Stars",
      show_shooting_stars: "Shooting stars",
      sun_azimuth: "Sun follows azimuth",
      show_rainbow: "Rainbow after rain",
      show_frost: "Frost below freezing",
      intensity: "Precipitation intensity",
      hysteresis: "Scene change delay",
      dark_dim: "Dim bright skies in dark theme",
      light_lift: "Lift dark skies in light theme",
    },
    helpers: {
      show_panel: "The scene preview and device settings panel stays visible outside edit mode. Turn off when you are done testing.",
      precipitation_entity: "A sensor with the current precipitation rate; without it, density follows the weather state.",
      pm25_entity: "Haze appears from about 25 µg/m³ and is dense above about 130 µg/m³.",
      kp_entity: "E.g. NOAA Space Weather. Aurora appears only when Kp is high enough for your latitude, at night and under a clear sky.",
      warning_entity: "E.g. Meteoalarm. The glow colour follows the warning level.",
      hysteresis: "How many minutes a new weather state has to last before the background changes.",
      lightning_flash: "Turned off automatically when the system asks to reduce motion.",
    },
    panel: {
      device: "On this device",
      enabled: "Background on",
      animations: "Animations",
      anim: { auto: "Automatic", on: "Always", off: "Off" },
      quality: "Quality",
      q: { auto: "Automatic", low: "Power saving", high: "High" },
      preview: "Scene preview",
      weather: "Weather",
      real: "Real",
      effect: "Effect",
      none: "None",
      fx: { rainbow: "Rainbow", frost: "Frost", smog: "Smog", aurora: "Aurora", warning: "Warning" },
      sun: "Sun",
      note: "The preview lasts until the page is reloaded.",
      reset: "Real data",
      info: {
        sun: (v) => `sun ${v}°`,
        clouds: (v) => `clouds ${v}%`,
        wind: (v) => `wind ${v} km/h`,
        moon: (v) => `moon ${v}%`,
        rainbow: "rainbow",
        aurora: "aurora",
        warning: (v) => `warning level ${v}`,
        waiting: (v) => `pending: ${v}`,
      },
      warnNoEntity: "Choose a weather entity in the card settings.",
      warnMissing: (e) => `Entity ${e} not found.`,
      warnDisabled: "The background is turned off on this device.",
    },
  },
  pl: {
    name: "HA Weather Dynamic Background",
    description: "Żywe tło dashboardu zależne od pogody, pory dnia i fazy księżyca.",
    cond: {
      sunny: "Słonecznie",
      "clear-night": "Bezchmurnie",
      partlycloudy: "Częściowe zachmurzenie",
      cloudy: "Pochmurno",
      fog: "Mgła",
      rainy: "Deszcz",
      pouring: "Ulewa",
      lightning: "Burza",
      "lightning-rainy": "Burza z deszczem",
      snowy: "Śnieg",
      "snowy-rainy": "Deszcz ze śniegiem",
      hail: "Grad",
      windy: "Wietrznie",
      "windy-variant": "Wietrznie, pochmurno",
      exceptional: "Wyjątkowe warunki",
    },
    labels: {
      show_panel: "Pokaż panel na dashboardzie",
      weather_entity: "Encja pogody",
      sun_entity: "Encja słońca",
      precipitation_entity: "Natężenie opadu (opcjonalnie, mm/h)",
      pm25_entity: "Czujnik PM2.5 (opcjonalnie) – smog",
      kp_entity: "Indeks Kp (opcjonalnie) – zorza",
      warning_entity: "Ostrzeżenia pogodowe (opcjonalnie)",
      animations: "Animacje",
      lightning_flash: "Błyski podczas burzy",
      show_moon: "Księżyc",
      show_stars: "Gwiazdy",
      show_shooting_stars: "Spadające gwiazdy",
      sun_azimuth: "Słońce według azymutu",
      show_rainbow: "Tęcza po deszczu",
      show_frost: "Szron przy mrozie",
      intensity: "Intensywność opadów",
      hysteresis: "Opóźnienie zmiany sceny",
      dark_dim: "Przyciemnienie jasnego nieba w motywie ciemnym",
      light_lift: "Rozjaśnienie ciemnego nieba w motywie jasnym",
    },
    helpers: {
      show_panel: "Panel z podglądem scen i ustawieniami urządzenia będzie widoczny także poza trybem edycji. Wyłącz po zakończeniu testów.",
      precipitation_entity: "Sensor z bieżącym opadem; bez niego gęstość wynika ze stanu pogody.",
      pm25_entity: "Np. Airly lub GIOŚ. Od ok. 25 µg/m³ niebo robi się mgliste i brązowawe.",
      kp_entity: "Np. sensor NOAA Space Weather. Zorza pojawia się tylko, gdy Kp jest wystarczające dla Twojej szerokości geograficznej, w nocy i przy czystym niebie.",
      warning_entity: "Np. Meteoalarm lub IMGW. Kolor poświaty u góry zależy od stopnia ostrzeżenia.",
      hysteresis: "Ile minut nowy stan pogody musi się utrzymać, zanim tło się zmieni.",
      lightning_flash: "Wyłączane automatycznie przy systemowym „Ogranicz ruch”.",
    },
    panel: {
      device: "Na tym urządzeniu",
      enabled: "Tło włączone",
      animations: "Animacje",
      anim: { auto: "Automatycznie", on: "Zawsze", off: "Wyłączone" },
      quality: "Jakość",
      q: { auto: "Automatyczna", low: "Oszczędna", high: "Wysoka" },
      preview: "Podgląd scen",
      weather: "Pogoda",
      real: "Rzeczywista",
      effect: "Efekt",
      none: "Brak",
      fx: { rainbow: "Tęcza", frost: "Szron", smog: "Smog", aurora: "Zorza", warning: "Ostrzeżenie" },
      sun: "Słońce",
      note: "Podgląd działa do odświeżenia strony.",
      reset: "Rzeczywiste dane",
      info: {
        sun: (v) => `słońce ${v}°`,
        clouds: (v) => `zachmurzenie ${v}%`,
        wind: (v) => `wiatr ${v} km/h`,
        moon: (v) => `księżyc ${v}%`,
        rainbow: "tęcza",
        aurora: "zorza",
        warning: (v) => `ostrzeżenie st. ${v}`,
        waiting: (v) => `czeka: ${v}`,
      },
      warnNoEntity: "Wybierz encję pogody w ustawieniach karty.",
      warnMissing: (e) => `Nie znaleziono encji ${e}.`,
      warnDisabled: "Tło jest wyłączone na tym urządzeniu.",
    },
  },
};

function lang(hass) {
  const l = String(
    hass?.locale?.language || hass?.language || document.documentElement.lang || navigator.language || "en"
  ).toLowerCase();
  return l.startsWith("pl") ? "pl" : "en";
}
const T = (hass) => STRINGS[lang(hass)];

function clearPalette(e) {
  for (let i = 1; i < CLEAR_KEYS.length; i++) {
    const [e1, p1] = CLEAR_KEYS[i];
    if (e <= e1) {
      const [e0, p0] = CLEAR_KEYS[i - 1];
      return mixPal(p0, p1, smooth(0, 1, (e - e0) / (e1 - e0)));
    }
  }
  return CLEAR_KEYS[CLEAR_KEYS.length - 1][1];
}

/* ------------------------------------------------------------------- moon */

function moonPhase(date) {
  const synodic = 29.530588853;
  const ref = Date.UTC(2000, 0, 6, 18, 14) / 86400000;
  let p = ((date.getTime() / 86400000 - ref) / synodic) % 1;
  return p < 0 ? p + 1 : p;
}

function drawMoonSprite(canvas, phase, southern) {
  const s = canvas.width;
  const ctx = canvas.getContext("2d");
  const c = s / 2;
  const r = s * 0.2;
  ctx.clearRect(0, 0, s, s);
  const glow = ctx.createRadialGradient(c, c, r * 0.6, c, c, s / 2);
  const illum = (1 - Math.cos(2 * Math.PI * phase)) / 2;
  glow.addColorStop(0, `rgba(220,228,255,${0.1 + 0.28 * illum})`);
  glow.addColorStop(0.45, `rgba(170,185,240,${0.04 + 0.08 * illum})`);
  glow.addColorStop(1, "rgba(170,185,240,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, s, s);
  // the unlit part hides the stars behind it and shows only a faint earthshine
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(8,12,28,0.72)";
  ctx.fill();
  ctx.fillStyle = "rgba(150,165,200,0.05)";
  ctx.fill();
  ctx.save();
  if (southern) {
    ctx.translate(s, 0);
    ctx.scale(-1, 1);
  }
  const k = Math.cos(2 * Math.PI * phase);
  ctx.beginPath();
  if (phase < 0.5) {
    ctx.arc(c, c, r, -Math.PI / 2, Math.PI / 2, false);
    ctx.ellipse(c, c, Math.abs(k) * r, r, 0, Math.PI / 2, -Math.PI / 2, k > 0);
  } else {
    ctx.arc(c, c, r, Math.PI / 2, (3 * Math.PI) / 2, false);
    ctx.ellipse(c, c, Math.abs(k) * r, r, 0, -Math.PI / 2, Math.PI / 2, k > 0);
  }
  ctx.closePath();
  const lit = ctx.createRadialGradient(c - r * 0.3, c - r * 0.3, r * 0.1, c, c, r);
  lit.addColorStop(0, "#fdfcf6");
  lit.addColorStop(1, "#d6d9e3");
  ctx.fillStyle = lit;
  ctx.shadowColor = "rgba(235,240,255,0.65)";
  ctx.shadowBlur = r * 0.35;
  ctx.fill();
  // surface: dark "seas" and fine mottling from noise, so it reads as the real Moon
  ctx.save();
  ctx.clip();
  ctx.shadowBlur = 0;
  ctx.globalCompositeOperation = "multiply";
  ctx.drawImage(moonSurface(), c - r, c - r, r * 2, r * 2);
  ctx.globalCompositeOperation = "source-over";
  const limb = ctx.createRadialGradient(c, c, r * 0.65, c, c, r);
  limb.addColorStop(0, "rgba(150,158,180,0)");
  limb.addColorStop(1, "rgba(150,158,180,0.22)");
  ctx.fillStyle = limb;
  ctx.fillRect(c - r, c - r, r * 2, r * 2);
  ctx.restore();
  ctx.restore();
}

let _moonSurface = null;
function moonSurface() {
  if (_moonSurface) return _moonSurface;
  const S = 192;
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const g = cv.getContext("2d");
  const img = g.createImageData(S, S);
  const n = makeNoise(42);
  const n2 = makeNoise(77);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      // large maria concentrated in the upper half, like the near side of the Moon
      const m = fbm(n, u * 3.2, v * 3.2, 4) + (0.5 - v) * 0.22 - (u - 0.5) * 0.08;
      const sea = smooth(0.5, 0.6, m);
      const fine = fbm(n2, u * 14, v * 14, 3);
      let l = 248 - sea * 62 - (fine - 0.5) * 28;
      const o = (y * S + x) * 4;
      img.data[o] = l;
      img.data[o + 1] = l * 0.99;
      img.data[o + 2] = l * 0.985;
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  _moonSurface = cv;
  return cv;
}

/* ------------------------------------------------------------------ scene */

function computeScene(input, cfg) {
  const e = input.elevation;
  const info = CONDITIONS[input.condition] || { cov: 50 };
  const precip = !!(info.rain || info.snow || info.storm || info.hail || info.fog);
  let cov = num(input.coverage);
  cov = cov === undefined ? info.cov : cov;
  if (precip) cov = Math.max(cov, 80);

  const day = smooth(-6, 6, e);
  const windKmh = Math.max(num(input.windKmh) ?? 0, info.wind ?? 0);
  const bearing = num(input.windBearing);
  const dirX = bearing === undefined ? 0.6 : -Math.sin((bearing * Math.PI) / 180);

  let pal = clearPalette(e);
  const palKey = info.pal || "overcast";
  const wp = mixPal(WEATHER_PAL[palKey].night, WEATHER_PAL[palKey].day, day);
  const k = precip ? info.k ?? 0.85 : smooth(40, 95, cov) * 0.97;
  pal = mixPal(pal, wp, k);

  const fogVis = num(input.visibility);
  let fog = info.fog ? 1 : 0;
  if (fogVis !== undefined) fog = Math.max(fog, 1 - smooth(1, 8, fogVis));
  if (fog > 0 && !info.fog) {
    const fp = mixPal(WEATHER_PAL.fog.night, WEATHER_PAL.fog.day, day);
    pal = mixPal(pal, fp, fog * 0.6);
  }

  // smog: brownish haze that thickens towards the horizon
  const pm = num(input.pm25);
  const smog = pm === undefined ? 0 : smooth(25, 130, pm);
  if (smog > 0) {
    const sc = mixRgb([52, 48, 44], [178, 162, 138], day);
    pal = pal.map((c, i) => mixRgb(c, sc, smog * [0.12, 0.28, 0.42, 0.55][i]));
  }

  const skyLum = (luminance(pal[0]) + luminance(pal[1]) + luminance(pal[2])) / 3;
  const skyDark = 1 - smooth(0.06, 0.4, skyLum);

  const scale = cfg.intensity / 100;
  let rain = (info.rain || 0) * scale;
  const rate = num(input.precipRate);
  if (rate !== undefined && info.rain) rain = clamp(rate / 6, 0.12, 1) * scale;

  const az = num(input.azimuth);
  const sunX = cfg.sun_azimuth && az !== undefined ? lerp(0.08, 0.92, clamp((az - 90) / 180, 0, 1)) : 0.86;
  const sunY = lerp(0.34, -0.06, smooth(0, 35, e));
  const sunVis = day * (1 - smooth(45, 95, cov)) * (precip ? 0.15 : 1);

  // rainbow: sun low and shining, rain just stopped
  const rainbow =
    cfg.show_rainbow && input.rainbow && !precip ? smooth(-1, 5, e) * (1 - smooth(38, 46, e)) * (1 - smooth(65, 90, cov)) : 0;

  const temp = num(input.temperature);
  const frost = cfg.show_frost && temp !== undefined ? smooth(1, -6, temp) : 0;

  // aurora: visible south of the auroral oval only during strong geomagnetic storms
  const kp = num(input.kp);
  const lat = Math.abs(num(input.latitude) ?? 52);
  const kpNeed = (66.5 - lat) / 2;
  const aurora =
    kp === undefined ? 0 : smooth(kpNeed - 1, kpNeed + 1.5, kp) * (1 - smooth(-14, -8, e)) * (1 - smooth(35, 75, cov));

  return {
    condition: input.condition,
    gradient: `linear-gradient(180deg, ${rgb(pal[0])} 0%, ${rgb(pal[1])} 38%, ${rgb(pal[2])} 72%, ${rgb(pal[3])} 100%)`,
    skyLum,
    skyDark,
    day,
    sun: sunVis,
    sunX,
    sunY,
    sunWarm: 1 - smooth(4, 22, e),
    // the moon fades gradually behind thickening cloud instead of vanishing
    moon: cfg.show_moon ? (1 - smooth(-6, 3, e)) * (1 - smooth(35, 97, cov) * 0.92) * (info.storm ? 0.35 : 1) : 0,
    stars: cfg.show_stars ? (1 - smooth(-14, -5, e)) * (1 - smooth(25, 70, cov)) : 0,
    // overcast skies are a continuous layer; separate cumulus only while there are gaps
    sheet: Math.max(smooth(55, 98, cov), precip ? 0.9 : 0) * (1 - fog * 0.5),
    // the cloud deck at the top of the sky: a broken layer first, a dense one as cover grows
    cloudCount: smooth(5, 45, cov) * (1 - fog * 0.85),
    cloudLow: smooth(45, 95, cov) * (1 - fog * 0.85),
    cloudAlpha: lerp(0.9, 1, day),

    // snow and fog skies have pale, soft clouds; rain and storms heavy grey ones
    cloudTone: clamp(
      Math.max((precip ? k * 0.9 + 0.25 : k * 0.5) * (palKey === "snow" ? 0.4 : palKey === "fog" ? 0.3 : 1), (1 - day) * 0.85),
      0,
      1
    ),
    cloudSpeed: (3 + windKmh * 0.3) * (dirX >= 0 ? 1 : -1),
    rain,
    snow: (info.snow || 0) * scale,
    hail: (info.hail || 0) * scale,
    storm: info.storm ? 1 : 0,
    fog,
    tilt: clamp(dirX * (windKmh / 55), -0.5, 0.5),
    drift: dirX * windKmh * 0.7,
    phase: input.moonPhase,
    shooting: !!cfg.show_shooting_stars,
    rainbow,
    rainbowX: 1 - sunX,
    frost,
    smog,
    aurora,
    warning: input.warning || 0,
  };
}

/* ---------------------------------------------------------------- sprites */

/* ------------------------------------------------------------ procedural noise */

// Value noise on a 256 lattice; `px` makes it repeat horizontally every px units (tileable sheets).
function makeNoise(seed) {
  const r = mulberry(seed);
  const v = new Float32Array(256 * 256);
  for (let i = 0; i < v.length; i++) v[i] = r();
  return (x, y, px) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const p = px || 256;
    const x0 = ((xi % p) + p) % p & 255;
    const x1 = (((xi + 1) % p) + p) % p & 255;
    const y0 = yi & 255;
    const y1 = (yi + 1) & 255;
    const a = v[y0 * 256 + x0];
    const b = v[y0 * 256 + x1];
    const c = v[y1 * 256 + x0];
    const d = v[y1 * 256 + x1];
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  };
}

function fbm(noise, x, y, oct, px) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let f = 1;
  for (let i = 0; i < oct; i++) {
    sum += amp * noise(x * f, y * f, px ? px * f : 0);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

// Cloud deck: soft, mottled stratocumulus that is thickest
// at the top of the sky and thins out downwards. Horizontally tileable. The density field is
// built a few rows at a time (step) so the page never stalls; it can then be coloured cheaply.
class CloudDeck {
  constructor(seed, W, H, cover) {
    this.W = W;
    this.H = H;
    this.cover = cover;
    this.n = makeNoise(seed);
    this.n2 = makeNoise(seed + 71);
    this.S = new Float32Array(W * H);
    this.F = new Float32Array(W * H);
    this.row = 0;
  }

  get done() {
    return this.row >= this.H;
  }

  step(rows) {
    const { W, H, n, n2, S, F, cover } = this;
    const P = 6;
    const end = Math.min(H, this.row + rows);
    for (let y = this.row; y < end; y++) {
      const v = y / H;
      const vv = v * 2.6;
      const env = smooth(1, 0.1, v);
      for (let x = 0; x < W; x++) {
        const u = (x / W) * P;
        const wx = (fbm(n2, u, vv, 2, P) - 0.5) * 0.35;
        const wy = (fbm(n2, u + 9, vv + 4, 2, P) - 0.5) * 0.3;
        const lo = fbm(n, u + wx, vv + wy, 4, P);
        const bl = 1 - Math.abs(2 * fbm(n2, (u + wx) * 2, (vv + wy) * 2, 3, P * 2) - 1);
        const hi = fbm(n, (u + wx) * 5, (vv + wy) * 5, 4, P * 5);
        const base = (lo * 0.65 + bl * 0.35 - 0.5) * 3 + 0.5;
        const i = y * W + x;
        S[i] = base - (1 - cover) * 0.8 + env * 0.08 - 0.14;
        F[i] = S[i] + (hi - 0.5) * 0.75;
      }
    }
    this.row = end;
    return this.done;
  }

  // colours the deck: thicker parts lighter (lit from above), thin parts fade into the sky
  paint(pal, fadeTop) {
    const { W, H, S, F } = this;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const g = c.getContext("2d");
    const img = g.createImageData(W, H);
    const px = img.data;
    const [lit, mid, shade] = pal;
    const k = H * 0.015;
    for (let y = 1; y < H - 1; y++) {
      const fadeV = smooth(1, 0.55, y / H) * (fadeTop ? smooth(0, 0.35, y / H) : 1);
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const d = smooth(-0.25, 0.75, F[i]);
        if (d <= 0) continue;
        const gx = (S[y * W + ((x + 1) % W)] - S[y * W + ((x + W - 1) % W)]) * k;
        const gy = (S[i + W] - S[i - W]) * k;
        const l = clamp((gx * 0.25 + gy * 0.9 + 0.45) / Math.hypot(gx, gy, 1), 0, 1);
        const t = clamp(d * 0.95 + (l - 0.5) * 0.12, 0, 1);
        const a = t < 0.5 ? t * 2 : (t - 0.5) * 2;
        const c0 = t < 0.5 ? shade : mid;
        const c1 = t < 0.5 ? mid : lit;
        const o = i * 4;
        px[o] = c0[0] + (c1[0] - c0[0]) * a;
        px[o + 1] = c0[1] + (c1[1] - c0[1]) * a;
        px[o + 2] = c0[2] + (c1[2] - c0[2]) * a;
        px[o + 3] = 255 * Math.min(1, d * 1.6) * fadeV;
      }
    }
    g.putImageData(img, 0, 0);
    // soften slightly (slightly out-of-focus clouds look more natural); blur with the
    // neighbouring tiles in place so the edges stay seamless
    const M = 8;
    const wide = document.createElement("canvas");
    wide.width = W + M * 2;
    wide.height = H;
    const wg = wide.getContext("2d");
    for (const dx of [-W, 0, W]) wg.drawImage(c, M + dx, 0);
    // the blur must run over the joined tiles in one pass, or the seams go soft
    const soft = document.createElement("canvas");
    soft.width = W + M * 2;
    soft.height = H;
    const sg = soft.getContext("2d");
    sg.filter = "blur(0.6px)";
    sg.drawImage(wide, 0, 0);
    const out = document.createElement("canvas");
    out.width = W * 2;
    out.height = H;
    const og = out.getContext("2d");
    og.drawImage(soft, M, 0, W, H, 0, 0, W, H);
    og.drawImage(soft, M, 0, W, H, W, 0, W, H);
    return out;
  }
}

// lit / mid / shade colours of the clouds for each kind of sky
const DECK_PAL = {
  white: [[250, 251, 253], [216, 224, 235], [168, 186, 212]],
  grey: [[184, 189, 197], [143, 149, 158], [108, 116, 127]],
  dark: [[138, 144, 152], [98, 105, 115], [72, 79, 89]],
  night: [[86, 96, 116], [58, 68, 88], [38, 48, 68]],
};

// A raindrop sitting on glass: dark rim, refracted light pooled at the bottom, a small highlight.
function makeWaterDropSprite() {
  const S = 64;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d");
  const rad = (x, y, r, stops) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    for (const [o, col] of stops) gr.addColorStop(o, col);
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
  };
  rad(32, 34, 30, [[0, "rgba(0,0,0,0)"], [0.76, "rgba(0,0,0,0)"], [0.9, "rgba(0,0,0,0.3)"], [1, "rgba(0,0,0,0)"]]);
  g.save();
  g.beginPath();
  g.arc(32, 32, 27, 0, Math.PI * 2);
  g.clip();
  rad(32, 32, 27, [[0, "rgba(255,255,255,0.04)"], [1, "rgba(255,255,255,0.12)"]]);
  rad(32, 20, 16, [[0, "rgba(0,0,0,0.14)"], [1, "rgba(0,0,0,0)"]]);
  rad(32, 44, 19, [[0, "rgba(255,255,255,0.6)"], [1, "rgba(255,255,255,0)"]]);
  g.restore();
  rad(24, 20, 6, [[0, "rgba(255,255,255,0.9)"], [1, "rgba(255,255,255,0)"]]);
  return c;
}

function makeDotSprite(size, core) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, "rgba(255,255,255,1)");
  gr.addColorStop(core, "rgba(255,255,255,0.85)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  return c;
}

function makeAuroraSprite() {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 256;
  const g = c.getContext("2d");
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, "rgba(200,90,190,0)");
  gr.addColorStop(0.18, "rgba(210,90,170,0.28)");
  gr.addColorStop(0.42, "rgba(90,250,170,0.75)");
  gr.addColorStop(0.75, "rgba(60,215,150,0.28)");
  gr.addColorStop(1, "rgba(60,215,150,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, 4, 256);
  return c;
}

// Ice crystals growing in from the screen edges, like a frosted window pane.
function paintFrost(canvas, w, h) {
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const g = canvas.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const depth = Math.min(w, h) * 0.16;
  const edges = [
    [0, 0, 0, depth],
    [0, h, 0, h - depth],
    [0, 0, depth, 0],
    [w, 0, w - depth, 0],
  ];
  for (const [x0, y0, x1, y1] of edges) {
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, "rgba(235,244,255,0.42)");
    gr.addColorStop(1, "rgba(235,244,255,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  }
  const r = mulberry(77);
  const n = Math.round((w + h) * 1.6);
  g.lineCap = "round";
  for (let i = 0; i < n; i++) {
    const side = Math.floor(r() * 4);
    const d = Math.pow(r(), 2.2) * depth * 1.15;
    const t = r();
    const x = side === 0 ? d : side === 1 ? w - d : t * w;
    const y = side === 2 ? d : side === 3 ? h - d : t * h;
    const len = 3 + r() * 11 * (1 - d / (depth * 1.2));
    const a0 = r() * Math.PI;
    g.strokeStyle = `rgba(245,250,255,${(0.18 + r() * 0.45) * (1 - d / (depth * 1.3))})`;
    g.lineWidth = 0.5 + r() * 0.7;
    g.beginPath();
    for (let k = 0; k < 3; k++) {
      const a = a0 + (k * Math.PI) / 3;
      g.moveTo(x - Math.cos(a) * len, y - Math.sin(a) * len);
      g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    }
    g.stroke();
  }
}

/* --------------------------------------------------------------- renderer */

const LAYER_CSS = `
:host{position:fixed;inset:0;z-index:-1;pointer-events:none;overflow:hidden;contain:strict;display:block}
.sky{position:absolute;inset:0}
#skyB{opacity:0}
#skyB.fade{transition:opacity 1.8s ease}
#sun{position:absolute;border-radius:50%;width:150vmax;height:150vmax;left:86%;top:-6%;transform:translate(-50%,-50%);opacity:0;transition:opacity 2.5s ease, background 2.5s ease, left 6s ease, top 6s ease}
#rainbow{--rb:max(170vmin,120vmax);position:absolute;width:var(--rb);height:var(--rb);left:20%;top:calc(100% - var(--rb) * 0.46);transform:translateX(-50%);opacity:0;transition:opacity 10s ease, left 6s ease;filter:blur(5px) saturate(.9);mix-blend-mode:screen;
  background:
    radial-gradient(circle at 50% 50%,transparent 0 40.4%,rgba(255,255,255,.07) 41.4%,transparent 42.4%),
    radial-gradient(circle at 50% 50%,transparent 0 42%,rgba(130,95,205,.18) 42.8%,rgba(80,130,230,.28) 43.8%,rgba(90,200,150,.30) 44.8%,rgba(240,225,120,.32) 45.8%,rgba(250,170,90,.28) 46.8%,rgba(235,100,80,.22) 47.8%,transparent 49%),
    radial-gradient(circle at 50% 50%,transparent 0 51.5%,rgba(235,100,80,.07) 52.5%,rgba(240,225,120,.08) 54%,rgba(80,130,230,.07) 55.5%,transparent 56.5%);
  -webkit-mask:linear-gradient(to bottom,#000 0,#000 22%,transparent 46%);mask:linear-gradient(to bottom,#000 0,#000 22%,transparent 46%)}
#smog{position:absolute;inset:0;opacity:0;transition:opacity 5s ease;background:linear-gradient(to bottom,rgba(var(--smogc),.1) 0%,rgba(var(--smogc),.45) 65%,rgba(var(--smogc),.62) 100%)}
#frost{opacity:0;transition:opacity 5s ease}
#warn{position:absolute;left:0;right:0;top:0;height:34vh;opacity:0;transition:opacity 3s ease;background:radial-gradient(ellipse 90% 100% at 50% 0%,var(--wc,rgba(255,204,0,.32)) 0%,transparent 72%)}
#warn.on{animation:breathe 8s ease-in-out infinite}
@keyframes breathe{0%,100%{filter:opacity(.75)}50%{filter:opacity(1)}}
:host(.still) #warn.on{animation:none}
canvas{position:absolute;inset:0;width:100%;height:100%}
.fog{position:absolute;left:-50%;width:200%;opacity:0;transition:opacity 3s ease;background:radial-gradient(ellipse at center,var(--fogc) 0%,transparent 68%)}
#fog1{top:12%;height:55%;animation:fd 80s linear infinite alternate}
#fog2{bottom:-12%;height:60%;animation:fd 110s linear infinite alternate-reverse}
@keyframes fd{from{transform:translateX(-12%)}to{transform:translateX(12%)}}
#flash{position:absolute;inset:0;opacity:0;background:radial-gradient(ellipse at 30% 0%,rgba(232,238,255,.95) 0%,rgba(175,190,255,.3) 45%,rgba(175,190,255,0) 80%)}
#dim{position:absolute;inset:0;background:#000;opacity:0;transition:opacity 1.5s ease}
#lift{position:absolute;inset:0;background:#fff;opacity:0;transition:opacity 1.5s ease}
:host(.still) .fog{animation:none}
`;

class SkyRenderer {
  constructor() {
    this.el = document.createElement("div");
    this.el.setAttribute("data-weather-dynamic-background", VERSION);
    this.el.setAttribute("aria-hidden", "true");
    const root = this.el.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${LAYER_CSS}</style>
      <div class="sky" id="skyA"></div><div class="sky" id="skyB"></div>
      <div id="sun"></div>
      <canvas id="skyc"></canvas>
      <canvas id="cl"></canvas>
      <div id="rainbow"></div>
      <canvas id="fx"></canvas>
      <canvas id="glass"></canvas>
      <canvas id="frost"></canvas>
      <div id="smog"></div>
      <div id="warn"></div>
      <div class="fog" id="fog1"></div><div class="fog" id="fog2"></div>
      <div id="flash"></div><div id="dim"></div><div id="lift"></div>`;
    this.$ = (id) => root.getElementById(id);
    this.canvas = this.$("fx");
    this.ctx = this.canvas.getContext("2d");
    this.skyCanvas = this.$("skyc");
    this.sctx = this.skyCanvas.getContext("2d");
    this.cloudCanvas = this.$("cl");
    this.cctx = this.cloudCanvas.getContext("2d");
    this.glassCanvas = this.$("glass");
    this.gctx = this.glassCanvas.getContext("2d");
    this.glass = [];
    this.glassAcc = 0;
    this.dropSprite = makeWaterDropSprite();
    this.bokehSprite = makeDotSprite(64, 0.02);
    this.gradient = "";
    this.target = null;
    this.cur = null;
    this.mode = { animate: true, quality: "auto", flash: true };
    this.mult = 1;
    this.costEma = 0;
    this.running = false;
    this.lastFrame = 0;
    this.strike = null;
    this.nextStrike = 0;
    this.moonSprite = document.createElement("canvas");
    this.moonSprite.width = this.moonSprite.height = 640;
    this.moonPhase = -1;
    // cloud textures are generated in small steps between frames so the page never stalls
    // two cloud decks (broken and dense); their colourings are made on demand per sky type
    this.decks = [new CloudDeck(4100, 640, 256, 0.45), new CloudDeck(4200, 640, 256, 0.62)];
    this.deckImg = [{}, {}];
    this.surfaceSprite = null;
    this.flakeSprite = makeDotSprite(32, 0.35);
    this.auroraSprite = makeAuroraSprite();
    this.frostCanvas = this.$("frost");
    this.frostSize = "";
    this.shoot = null;
    this.nextShoot = 0;
    this._onResize = () => this.resize();
    this._onVisibility = () => (document.hidden ? this.stop() : this.kick());
    this._loop = (t) => this.loop(t);
    const fb = this.$("skyB");
    fb.addEventListener("transitionend", () => this._settleSky());
  }

  mount(parent, before) {
    if (before) parent.insertBefore(this.el, before);
    else parent.appendChild(this.el);
    window.addEventListener("resize", this._onResize);
    document.addEventListener("visibilitychange", this._onVisibility);
    this.resize();
  }

  unmount() {
    this.stop();
    window.removeEventListener("resize", this._onResize);
    document.removeEventListener("visibilitychange", this._onVisibility);
    this.el.remove();
  }

  // Frees the GPU backing of every canvas this renderer owns. A detached canvas keeps its (accelerated) backing
  // store for as long as it is referenced, so without this the full-screen layers and sprites stay allocated
  // after the dashboard leaves the view. Only called on a renderer that is being dropped.
  release() {
    this.stop();
    // the cloud-deck generation chain and the cross-fade settle timer would otherwise run on after this,
    // drawing into the zeroed canvases (an InvalidStateError per detach in still mode)
    this._released = true;
    clearTimeout(this._genTimer);
    clearTimeout(this._settleTimer);
    this._genBusy = false;
    const sprites = [this.dropSprite, this.bokehSprite, this.flakeSprite, this.auroraSprite, this.moonSprite];
    for (const d of this.deckImg) for (const k in d) sprites.push(d[k]);
    for (const cv of [this.canvas, this.skyCanvas, this.cloudCanvas, this.glassCanvas, this.frostCanvas, ...sprites]) {
      if (cv) cv.width = cv.height = 0;
    }
    this.deckImg = [{}, {}];
  }

  setMode(mode) {
    const changed = JSON.stringify(mode) !== JSON.stringify(this.mode);
    this.mode = mode;
    this.el.classList.toggle("still", !mode.animate);
    if (mode.animate) this.glass = this.glass.filter((d) => d.max < 1e8);
    if (changed) {
      this.resize();
      this.kick();
    }
  }

  resize() {
    const w = window.innerWidth || 390;
    const h = window.innerHeight || 844;
    const q = this.mode.quality;
    const dpr = q === "low" ? 1 : Math.min(window.devicePixelRatio || 1, q === "high" ? 2 : 1.5);
    this.w = w;
    this.h = h;
    for (const [cv, cx] of [[this.canvas, this.ctx], [this.skyCanvas, this.sctx], [this.cloudCanvas, this.cctx], [this.glassCanvas, this.gctx]]) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    this.buildPools();
    this.frostSize = "";
    this.ensureFrost();
    if (!this.mode.animate) this.drawStatic();
  }

  // Builds the cloud decks a few rows per call; returns true while more work is pending.
  genStep() {
    const deck = this.decks.find((d) => !d.done);
    if (!deck) return false;
    deck.step(24);
    return this.decks.some((d) => !d.done);
  }

  deck(i, pal, fadeTop) {
    const d = this.decks[i];
    if (!d.done) return null;
    const key = fadeTop ? pal + "-f" : pal;
    return this.deckImg[i][key] || (this.deckImg[i][key] = d.paint(DECK_PAL[pal], fadeTop));
  }

  scheduleGen() {
    if (this._genBusy || this.decks.every((d) => d.done)) return;
    this._genBusy = true;
    const run = () => {
      this._genTimer = 0;
      if (this._released) return;
      const more = this.genStep();
      if (!this.mode.animate) this.drawStatic();
      if (more) this._genTimer = setTimeout(run, 16);
      else this._genBusy = false;
    };
    this._genTimer = setTimeout(run, 50);
  }

  ensureFrost() {
    const key = `${this.w}x${this.h}`;
    if (this.target && this.target.frost > 0.01 && this.frostSize !== key) {
      paintFrost(this.frostCanvas, this.w, this.h);
      this.frostSize = key;
    }
  }

  buildPools() {
    const area = (this.w * this.h) / (390 * 844);
    const base = this.mode.quality === "low" ? 0.5 : 1;
    const r = mulberry(1234);
    const n = (k) => Math.round(k * clamp(area, 0.6, 3.5) * base);
    this.drops = Array.from({ length: n(170) }, () => this.newDrop(r, true));
    this.flakes = Array.from({ length: n(130) }, () => this.newFlake(r, true));
    this.hail = Array.from({ length: n(90) }, () => this.newHail(r, true));
    this.stars = Array.from({ length: n(150) }, () => ({
      x: r() * this.w,
      y: Math.pow(r(), 1.3) * this.h * 0.8,
      s: r() < 0.88 ? 0.7 + r() * 0.8 : 1.6 + r() * 0.9,
      tw: 0.6 + r() * 1.8,
      ph: r() * 6.28,
      b: 0.45 + r() * 0.55,
    }));
    this.sheetX = [0, 0, 0];
  }

  // three depth layers: far drops are short, faint and slow; near ones long, brighter and fast
  newDrop(r, anywhere) {
    const q = r();
    const z = q < 0.5 ? 0 : q < 0.82 ? 1 : 2;
    const L = [[9, 7, 620, 160], [16, 12, 880, 220], [30, 26, 1250, 320]][z];
    return {
      x: r() * (this.w + 200) - 100,
      y: anywhere ? r() * this.h : -60 - r() * this.h * 0.3,
      len: L[0] + r() * L[1],
      sp: L[2] + r() * L[3],
      z,
    };
  }

  newFlake(r, anywhere) {
    if (r() < 0.1) {
      // out-of-focus flakes right in front of the "camera"
      const sz = 9 + r() * 10;
      return {
        x: r() * this.w,
        y: anywhere ? r() * this.h : -30 - r() * 40,
        sz,
        sp: 70 + r() * 45,
        ph: r() * 6.28,
        sw: 0.4 + r() * 0.6,
        amp: 18 + r() * 20,
        a: 0.18 + r() * 0.22,
        bokeh: true,
      };
    }
    const sz = 1.4 + Math.pow(r(), 2) * 4.2;
    return {
      x: r() * this.w,
      y: anywhere ? r() * this.h : -10 - r() * 40,
      sz,
      sp: 22 + sz * 12 + r() * 18,
      ph: r() * 6.28,
      sw: 0.5 + r() * 1.2,
      amp: 10 + r() * 22,
      a: 0.55 + r() * 0.45,
    };
  }

  newHail(r, anywhere) {
    return {
      x: r() * (this.w + 100) - 50,
      y: anywhere ? r() * this.h : -20 - r() * this.h * 0.3,
      sp: 650 + r() * 300,
      sz: 1.5 + r() * 1.8,
    };
  }

  setScene(scene) {
    this.target = scene;
    if (scene.cloudCount > 0.01 || scene.fog > 0.01) this.scheduleGen();
    if (!this.cur || !this.mode.animate) this.cur = { ...scene };
    this.cur.tilt = scene.tilt;
    this.cur.drift = scene.drift;
    this.cur.cloudSpeed = scene.cloudSpeed;
    this.applySky(scene.gradient);
    const sun = this.$("sun");
    const warm = [255, 196, 140];
    const core = mixRgb([255, 250, 232], [255, 226, 180], scene.sunWarm);
    const mid = mixRgb([255, 232, 170], warm, scene.sunWarm);
    sun.style.background = `radial-gradient(circle, ${rgb(core, 0.95)} 0%, ${rgb(mid, 0.6)} 12%, ${rgb(mid, 0.18)} 32%, ${rgb(mid, 0)} 60%)`;
    sun.style.opacity = scene.sun.toFixed(3);
    sun.style.left = `${(scene.sunX * 100).toFixed(1)}%`;
    sun.style.top = `${(scene.sunY * 100).toFixed(1)}%`;
    const rb = this.$("rainbow");
    rb.style.opacity = scene.rainbow.toFixed(3);
    if (scene.rainbow > 0.01) rb.style.left = `${(scene.rainbowX * 100).toFixed(1)}%`;
    const smog = this.$("smog");
    smog.style.setProperty("--smogc", scene.day > 0.5 ? "168,150,122" : "58,52,46");
    smog.style.opacity = scene.smog.toFixed(3);
    this.ensureFrost();
    this.frostCanvas.style.opacity = (scene.frost * 0.9).toFixed(3);
    const warn = this.$("warn");
    const wc = ["", "rgba(255,204,0,.30)", "rgba(255,140,0,.34)", "rgba(255,59,48,.36)"][scene.warning] || "";
    if (wc) warn.style.setProperty("--wc", wc);
    warn.style.opacity = scene.warning ? "1" : "0";
    warn.classList.toggle("on", !!scene.warning);
    const fogc = scene.day > 0.5 ? "rgba(236,240,244,.55)" : "rgba(120,130,145,.35)";
    for (const id of ["fog1", "fog2"]) {
      const f = this.$(id);
      f.style.setProperty("--fogc", fogc);
      f.style.opacity = (scene.fog * 0.45).toFixed(3);
    }
    if (scene.phase !== undefined && Math.abs(scene.phase - this.moonPhase) > 0.003) {
      this.moonPhase = scene.phase;
      drawMoonSprite(this.moonSprite, scene.phase, scene.southern);
    }
    this.$("dim").style.opacity = (scene.dim || 0).toFixed(3);
    this.$("lift").style.opacity = (scene.lift || 0).toFixed(3);
    if (!this.mode.animate) this.drawStatic();
    else this.kick();
  }

  applySky(gradient) {
    if (gradient === this.gradient) return;
    const a = this.$("skyA");
    const b = this.$("skyB");
    if (!this.gradient || !this.mode.animate) {
      a.style.background = gradient;
      b.classList.remove("fade");
      b.style.opacity = "0";
      this.gradient = gradient;
      return;
    }
    this.gradient = gradient;
    b.classList.remove("fade");
    b.style.opacity = "0";
    b.style.background = gradient;
    void b.offsetWidth;
    b.classList.add("fade");
    b.style.opacity = "1";
    clearTimeout(this._settleTimer);
    this._settleTimer = setTimeout(() => this._settleSky(), 2200);
  }

  _settleSky() {
    const a = this.$("skyA");
    const b = this.$("skyB");
    if (b.style.opacity !== "1") return;
    a.style.background = this.gradient;
    b.classList.remove("fade");
    b.style.opacity = "0";
  }

  kick() {
    if (this.running || !this.mode.animate || document.hidden || !this.el.isConnected) return;
    this.running = true;
    this.lastFrame = 0;
    requestAnimationFrame(this._loop);
  }

  stop() {
    this.running = false;
  }

  needsFast() {
    const c = this.cur;
    return c.rain > 0.01 || c.snow > 0.01 || c.hail > 0.01 || !!this.strike || !!this.shoot || this.glass.length > 0;
  }

  newGlassDrop(r, w, h) {
    const rad = 2.2 + Math.pow(r(), 2.5) * 8.5;
    return { x: r() * w, y: r() * h, r: rad, life: 0, max: 6 + r() * 12, slide: false, vy: 0, ph: r() * 6.28 };
  }

  // raindrops landing on the "glass", some of them sliding down and leaving a trail
  stepGlass(dt, c, w, h, r) {
    const area = clamp((w * h) / (390 * 844), 0.6, 3.5);
    const cap = Math.round(70 * area * this.mult);
    if (c.rain > 0.05 && this.glass.length < cap) {
      this.glassAcc += dt * c.rain * 9 * area;
      while (this.glassAcc > 1) {
        this.glassAcc -= 1;
        this.glass.push(this.newGlassDrop(r, w, h));
      }
    }
    const trail = [];
    this.glass = this.glass.filter((d) => {
      d.life += dt;
      if (!d.slide && d.r > 4.6 && r() < dt * 0.12) d.slide = true;
      if (d.slide) {
        d.vy = Math.min(d.vy + 45 * dt, 70 + d.r * 14);
        d.y += d.vy * dt;
        d.x += Math.sin(d.life * 3 + d.ph) * 6 * dt;
        if (r() < dt * 2.2) trail.push({ x: d.x, y: d.y - d.r, r: d.r * (0.25 + r() * 0.15), life: 0, max: 2 + r() * 3, slide: false, vy: 0, ph: 0 });
        return d.y < h + 20;
      }
      return d.life < d.max;
    });
    if (this.glass.length < cap * 1.3) this.glass.push(...trail);
  }

  loop(t) {
    if (!this.running) return;
    const ts = t / 1000;
    const fast = this.needsFast();
    const fps = fast ? (this.mode.quality === "high" ? 60 : this.mode.quality === "low" ? 24 : 30) : 20;
    if (this.lastFrame && t - this.lastFrame < 1000 / fps - 2) {
      requestAnimationFrame(this._loop);
      return;
    }
    const dt = this.lastFrame ? Math.min((t - this.lastFrame) / 1000, 0.1) : 1 / fps;
    this.lastFrame = t;
    const t0 = performance.now();
    this.step(ts, dt);
    this.draw(ts);
    const cost = performance.now() - t0;
    this.costEma = this.costEma ? this.costEma * 0.95 + cost * 0.05 : cost;
    if (this.mode.quality === "auto" && this.costEma > 11 && this.mult > 0.35) {
      this.mult *= 0.75;
      this.costEma = 0;
    }
    const idle =
      !fast &&
      this.cur.stars < 0.01 &&
      this.cur.cloudCount < 0.05 &&
      this.cur.sheet < 0.01 &&
      this.cur.fog < 0.01 &&
      this.cur.moon < 0.01 &&
      this.cur.aurora < 0.01 &&
      this.settled();
    if (idle) {
      this.running = false;
      return;
    }
    requestAnimationFrame(this._loop);
  }

  settled() {
    const c = this.cur;
    const g = this.target;
    return ["rain", "snow", "hail", "stars", "moon", "cloudCount", "cloudAlpha", "cloudTone", "storm", "aurora", "sheet", "fog", "cloudLow"].every(
      (k) => Math.abs(c[k] - g[k]) < 0.005
    );
  }

  step(ts, dt) {
    const c = this.cur;
    const g = this.target;
    const f = Math.min(1, dt * 0.7);
    for (const k of ["rain", "snow", "hail", "stars", "moon", "cloudCount", "cloudAlpha", "cloudTone", "storm", "aurora", "sheet", "fog", "cloudLow"]) {
      c[k] += (g[k] - c[k]) * f;
    }
    const r = Math.random;
    const w = this.w;
    const h = this.h;
    if (c.rain > 0.01) {
      const n = Math.ceil(this.drops.length * c.rain * this.mult);
      for (let i = 0; i < n; i++) {
        const d = this.drops[i];
        d.y += d.sp * dt;
        d.x += d.sp * dt * c.tilt;
        if (d.y - d.len > h || d.x < -120 || d.x > w + 120) {
          Object.assign(d, this.newDrop(r, false));
          d.x -= h * c.tilt * r(); // start upwind so slanted rain still covers the screen
        }
      }
    }
    if (c.snow > 0.01) {
      const n = Math.ceil(this.flakes.length * c.snow * this.mult);
      for (let i = 0; i < n; i++) {
        const p = this.flakes[i];
        p.y += p.sp * dt;
        p.x += (c.drift + Math.cos(ts * p.sw + p.ph) * p.amp) * dt;
        if (p.y > h + 10) Object.assign(p, this.newFlake(r, false));
        if (p.x > w + 20) p.x -= w + 40;
        if (p.x < -20) p.x += w + 40;
      }
    }
    this.stepGlass(dt, c, w, h, r);
    if (c.hail > 0.01) {
      const n = Math.ceil(this.hail.length * c.hail * this.mult);
      for (let i = 0; i < n; i++) {
        const p = this.hail[i];
        p.y += p.sp * dt;
        p.x += p.sp * dt * c.tilt * 0.6;
        if (p.y > h + 10) Object.assign(p, this.newHail(r, false));
      }
    }
    if (c.cloudCount > 0.01 || c.fog > 0.01) {
      for (let k = 0; k < 3; k++) this.sheetX[k] += c.cloudSpeed * (0.35 + k * 0.3) * dt;
    }

    if (g.shooting && c.stars > 0.4) {
      if (!this.nextShoot) this.nextShoot = ts + 6 + r() * 14;
      if (!this.shoot && ts >= this.nextShoot) {
        const ang = 0.12 + r() * 0.35; // always falling, to the left or right
        this.shoot = {
          t: ts,
          x: w * (0.15 + r() * 0.7),
          y: h * (0.05 + r() * 0.3),
          ang: r() < 0.5 ? ang : Math.PI - ang,
          sp: 650 + r() * 350,
          len: 70 + r() * 70,
          dur: 0.7 + r() * 0.5,
        };
        this.nextShoot = ts + 18 + r() * 30;
      }
    } else {
      this.nextShoot = 0;
    }
    if (this.shoot && ts - this.shoot.t > this.shoot.dur) this.shoot = null;
    if (this.mode.flash && c.storm > 0.5) {
      if (!this.nextStrike) this.nextStrike = ts + 3 + r() * 5;
      if (!this.strike && ts >= this.nextStrike) {
        this.strike = { t: ts, bolt: this.makeBolt(r), strength: 0.55 + r() * 0.35 };
        this.nextStrike = ts + 6 + r() * 10;
      }
    } else {
      this.nextStrike = 0;
    }
    if (this.strike) {
      const e = ts - this.strike.t;
      const env = e < 0.06 ? 1 : e < 0.12 ? 0.15 : e < 0.2 ? 0.7 : e < 0.45 ? 0.7 * (1 - (e - 0.2) / 0.25) : 0;
      this.$("flash").style.opacity = (env * this.strike.strength).toFixed(3);
      this.strike.env = env;
      if (e > 0.5) {
        this.strike = null;
        this.$("flash").style.opacity = "0";
      }
    }
  }

  makeBolt(r) {
    const pts = [];
    let x = this.w * (0.12 + r() * 0.76);
    let y = -10;
    const end = this.h * (0.3 + r() * 0.2);
    const branches = [];
    while (y < end) {
      pts.push([x, y]);
      y += 14 + r() * 22;
      x += (r() - 0.5) * 34;
      if (r() < 0.14) {
        const b = [[x, y]];
        let bx = x;
        let by = y;
        const dir = r() < 0.5 ? -1 : 1;
        for (let i = 0; i < 4 + r() * 4; i++) {
          by += 10 + r() * 16;
          bx += dir * (6 + r() * 14);
          b.push([bx, by]);
        }
        branches.push(b);
      }
    }
    pts.push([x, y]);
    return { pts, branches };
  }

  drawStatic() {
    if (!this.target) return;
    this.cur = { ...this.target };
    this.strike = null;
    this.shoot = null;
    this.$("flash").style.opacity = "0";
    // still scene: a fixed sprinkling of drops on the glass while it rains
    if (this.cur.rain > 0.05) {
      const r = mulberry(99);
      this.glass = Array.from({ length: Math.round(35 * this.cur.rain) }, () => ({ ...this.newGlassDrop(r, this.w, this.h), life: 2, max: 1e9 }));
    } else this.glass = [];
    this.draw(12.3);
  }

  draw(ts) {
    const c = this.cur;
    const w = this.w;
    const h = this.h;
    this.drawSky(ts, c, w, h);
    this.drawClouds(ts, c, w, h);
    this.drawFx(ts, c, w, h);
    this.drawGlass(c, w, h);
  }

  // stars, aurora, shooting stars and the moon: everything behind the clouds
  drawSky(ts, c, w, h) {
    const ctx = this.sctx;
    ctx.clearRect(0, 0, w, h);

    if (c.stars > 0.01) {
      ctx.fillStyle = "#fff";
      for (const s of this.stars) {
        const a = c.stars * s.b * (0.55 + 0.45 * Math.sin(ts * s.tw + s.ph));
        if (a < 0.02) continue;
        ctx.globalAlpha = a;
        if (s.s < 1.5) ctx.fillRect(s.x, s.y, s.s, s.s);
        else ctx.drawImage(this.flakeSprite, s.x - s.s, s.y - s.s, s.s * 2, s.s * 2);
      }
      ctx.globalAlpha = 1;
    }

    if (c.aurora > 0.01) {
      // slowly rippling curtains along the top of the sky
      const step = 5;
      const span = step * 5; // overlapping columns blend into soft curtains
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let x = -step; x < w + step; x += step) {
        const i = x / step;
        const ph = ts * 0.22 + i * 0.09;
        const amp = 0.5 + 0.25 * Math.sin(ph) + 0.25 * Math.sin(ph * 1.7 + i * 0.05);
        const edge = smooth(0, w * 0.15, x) * smooth(w, w * 0.85, x);
        const top = h * (0.01 + 0.035 * Math.sin(ts * 0.13 + i * 0.06));
        const hh = h * 0.38 * (0.55 + 0.45 * amp);
        ctx.globalAlpha = c.aurora * (0.03 + 0.12 * amp) * (0.35 + 0.65 * edge);
        ctx.drawImage(this.auroraSprite, x - span / 2, top, span, hh);
      }
      ctx.restore();
    }

    if (this.shoot) {
      const s = this.shoot;
      const e = ts - s.t;
      const p = e / s.dur;
      const hx = s.x + Math.cos(s.ang) * s.sp * e;
      const hy = s.y + Math.sin(s.ang) * s.sp * e;
      const tx = hx - Math.cos(s.ang) * s.len;
      const ty = hy - Math.sin(s.ang) * s.len;
      const fade = Math.sin(Math.min(1, p) * Math.PI) * c.stars;
      const gr = ctx.createLinearGradient(tx, ty, hx, hy);
      gr.addColorStop(0, "rgba(255,255,255,0)");
      gr.addColorStop(1, `rgba(255,255,255,${(0.9 * fade).toFixed(3)})`);
      ctx.strokeStyle = gr;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(hx, hy);
      ctx.stroke();
    }

    if (c.moon > 0.01 && this.moonPhase >= 0) {
      // disc diameter ~22% of the short side (≈ 86 px on a phone, capped on big screens)
      const size = clamp(Math.min(w, h) * 0.55, 200, 520);
      const rr = size * 0.2;
      const cx = w - Math.max(rr + 24, w * 0.18);
      const cy = rr + Math.max(76, h * 0.09); // clear of the dashboard header
      ctx.globalAlpha = c.moon;
      ctx.drawImage(this.moonSprite, cx - size / 2, cy - size / 2, size, size);
      ctx.globalAlpha = 1;
    }

  }

  drawClouds(ts, c, w, h) {
    const ctx = this.cctx;
    ctx.clearRect(0, 0, w, h);
    const tone = c.cloudTone;
    const tg = this.target || c;
    // which cloud colouring: white on a blue sky, grey when overcast, dark in rain, blue-grey at night
    const day = tg.day ?? 1;
    const wWhite = (1 - smooth(0.05, 0.45, tone)) * day;
    const wDark = smooth(0.55, 0.95, tone) * day;
    const wGrey = Math.max(0, day - wWhite - wDark);
    const wNight = 1 - day;
    const pals = [["white", wWhite], ["grey", wGrey], ["dark", wDark], ["night", wNight]].filter(([, wt]) => wt > 0.02);

    // overcast: the very top of the sky is one thick, even cloud layer
    const haze = c.sheet * smooth(0.5, 0.9, tone);
    if (haze > 0.01) {
      const col = mixRgb([70, 77, 88], [30, 38, 54], wNight);
      const gr = ctx.createLinearGradient(0, 0, 0, h * 0.4);
      gr.addColorStop(0, rgb(col, 0.4 * haze));
      gr.addColorStop(1, rgb(col, 0));
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, w, h * 0.4);
    }

    // draws one scrolling deck: sw = on-screen width of one tile (always wider than the screen)
    const blitDeck = (img, xs, sw, y, hh) => {
      const T = img.width / 2;
      let ox = ((-xs / sw) * T) % T;
      if (ox < 0) ox += T;
      ctx.drawImage(img, ox, 0, (T * w) / sw, img.height, 0, y, w, hh);
    };
    const layer = (i, a, y0, hh, sw, xs) => {
      if (a < 0.01) return;
      for (const [pal, wt] of pals) {
        const img = this.deck(i, pal);
        if (!img) continue;
        ctx.globalAlpha = a * wt;
        blitDeck(img, xs, sw, h * y0, h * hh);
      }
    };
    // back: broken deck, wide and slow; front: dense deck, reaching lower as cover grows
    const swB = Math.round(Math.max(w * 2, 1400));
    const swF = Math.round(Math.max(w * 1.7, 1150));
    layer(0, c.cloudCount * c.cloudAlpha, -0.03, 0.5 + c.cloudLow * 0.06, swB, this.sheetX[0]);
    layer(1, c.cloudLow * c.cloudAlpha, -0.06 + c.cloudLow * 0.03, 0.5 + c.cloudLow * 0.1, swF, this.sheetX[1] + swF * 0.37);

    // fog: wide, flat, soft banks drifting low
    if (c.fog > 0.01) {
      const pal = wNight > 0.5 ? "night" : "grey";
      [[0, 0.25, 0.45], [1, 0.45, 0.6], [0, 0.62, 0.75]].forEach(([v, y0, a], k) => {
        const img = this.deck(v, pal, true);
        if (!img) return;
        const sw = Math.max(w * 3.2, 1500);
        ctx.globalAlpha = c.fog * a * 0.45;
        blitDeck(img, this.sheetX[k] * 0.5 + k * 300, sw, h * y0, h * 0.32);
      });
    }
    ctx.globalAlpha = 1;
    // light the clouds: warm at golden hour, cool flash from lightning
    const g = this.target;
    const warm = g ? g.sunWarm * g.day * (1 - tone * 0.7) : 0;
    const flash = this.strike ? this.strike.env || 0 : 0;
    if (warm > 0.02 || flash > 0.02) {
      ctx.save();
      ctx.globalCompositeOperation = "source-atop";
      if (warm > 0.02) {
        ctx.fillStyle = `rgba(255,168,110,${(0.38 * warm).toFixed(3)})`;
        ctx.fillRect(0, 0, w, h);
      }
      if (flash > 0.02) {
        ctx.fillStyle = `rgba(215,225,255,${(0.6 * flash).toFixed(3)})`;
        ctx.fillRect(0, 0, w, h);
      }
      ctx.restore();
    }
  }

  drawGlass(c, w, h) {
    const ctx = this.gctx;
    ctx.clearRect(0, 0, w, h);
    if (!this.glass.length) return;
    const night = 1 - (this.target ? this.target.day : 1);
    const base = 0.95 - night * 0.35;
    for (const d of this.glass) {
      const fade = d.slide ? 1 : Math.min(1, d.life * 3, (d.max - d.life) / 1.2);
      if (fade <= 0.01) continue;
      ctx.globalAlpha = fade * base;
      const s = d.r * 2.3;
      const sy = d.slide ? s * 1.18 : s;
      ctx.drawImage(this.dropSprite, d.x - s / 2, d.y - sy / 2, s, sy);
    }
    ctx.globalAlpha = 1;
  }

  // lightning bolt and precipitation: in front of everything
  drawFx(ts, c, w, h) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);
    if (this.strike && this.strike.env > 0.02) {
      const { pts, branches } = this.strike.bolt;
      ctx.save();
      ctx.globalAlpha = Math.min(1, this.strike.env * 1.2);
      ctx.strokeStyle = "rgba(240,244,255,0.95)";
      ctx.shadowColor = "rgba(190,205,255,0.9)";
      ctx.shadowBlur = 14;
      ctx.lineJoin = "round";
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
      ctx.lineWidth = 1.2;
      for (const b of branches) {
        ctx.beginPath();
        b.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
      }
      ctx.restore();
    }

    const night = 1 - (this.target ? this.target.day : 1);
    if (c.rain > 0.01) {
      const n = Math.ceil(this.drops.length * c.rain * this.mult);
      const col = night > 0.5 ? "176,194,222" : "222,232,246";
      ctx.lineCap = "round";
      for (let z = 0; z < 3; z++) {
        ctx.strokeStyle = `rgba(${col},${[0.16, 0.26, 0.38][z]})`;
        ctx.lineWidth = [0.7, 1, 1.4][z];
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const d = this.drops[i];
          if (d.z !== z) continue;
          ctx.moveTo(d.x, d.y);
          ctx.lineTo(d.x - d.len * c.tilt, d.y - d.len);
        }
        ctx.stroke();
      }
    }

    if (c.hail > 0.01) {
      const n = Math.ceil(this.hail.length * c.hail * this.mult);
      ctx.fillStyle = "rgba(240,246,255,0.85)";
      for (let i = 0; i < n; i++) {
        const p = this.hail[i];
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.sz, 0, 6.283);
        ctx.fill();
      }
    }

    if (c.snow > 0.01) {
      const n = Math.ceil(this.flakes.length * c.snow * this.mult);
      for (let i = 0; i < n; i++) {
        const p = this.flakes[i];
        ctx.globalAlpha = p.a;
        const s = p.sz * 2.4;
        ctx.drawImage(p.bokeh ? this.bokehSprite : this.flakeSprite, p.x - s / 2, p.y - s / 2, s, s);
      }
      ctx.globalAlpha = 1;
    }
  }
}

/* ---------------------------------------------------------------- manager */

function readDevice() {
  try {
    return { ...DEVICE_DEFAULTS, ...JSON.parse(localStorage.getItem(DEVICE_KEY) || "{}") };
  } catch (e) {
    return { ...DEVICE_DEFAULTS };
  }
}

function writeDevice(d) {
  try {
    localStorage.setItem(DEVICE_KEY, JSON.stringify(d));
  } catch (e) {
    /* storage unavailable */
  }
}

const WET = ["rainy", "pouring", "lightning-rainy", "snowy-rainy", "hail"];

// Weather warning level 0–3 from Meteoalarm, IMGW or any on/off or numeric entity.
function parseWarning(st) {
  if (!st) return 0;
  const s = String(st.state).toLowerCase();
  if (["off", "0", "none", "unknown", "unavailable", "brak", "", "false"].includes(s)) return 0;
  const a = st.attributes || {};
  const txt = [s, a.awareness_level, a.level, a.severity, a.color, a.colour].join(" ").toLowerCase();
  if (/red|czerwon|extreme/.test(txt)) return 3;
  if (/orange|pomara|severe/.test(txt)) return 2;
  if (/yellow|żółt|zolt|moderate/.test(txt)) return 1;
  const n = num(s);
  if (n !== undefined) return clamp(Math.round(n), 0, 3);
  return 1;
}

function findViewContainer(node) {
  let n = node;
  while (n) {
    if (n.localName === "hui-view-container") return n;
    n = n instanceof ShadowRoot ? n.host : n.parentNode;
  }
  return null;
}

const mq = (q) => (window.matchMedia ? window.matchMedia(q) : { matches: false, addEventListener() {} });

class Manager {
  constructor() {
    this.owners = new Set();
    this.renderer = null;
    this.container = null;
    this.config = { ...DEFAULTS };
    this.hass = null;
    this.device = readDevice();
    this.sim = { condition: "", elevation: null, effect: "" };
    this.shown = null;
    this.candidate = null;
    this.since = 0;
    this.lastInput = null;
    this.scene = null;
    this.reducedMotion = mq("(prefers-reduced-motion: reduce)");
    this.reducedTransparency = mq("(prefers-reduced-transparency: reduce)");
    const re = () => this.refresh();
    this.reducedMotion.addEventListener?.("change", re);
    this.reducedTransparency.addEventListener?.("change", re);
    this.observer = new MutationObserver(() => {
      if (this.renderer && this.container && !this.renderer.el.isConnected && this.owners.size) {
        this.attachTo(this.container);
      }
    });
    setInterval(() => this.refresh(), 60000);
  }

  register(card) {
    this.owners.add(card);
    clearTimeout(this.detachTimer);
    this.ensureAttached(card);
  }

  unregister(card) {
    this.owners.delete(card);
    if (!this.owners.size) {
      clearTimeout(this.detachTimer);
      this.detachTimer = setTimeout(() => this.detach(), 600);
    }
  }

  ensureAttached(card) {
    if (!this.device.enabled) {
      this.detach();
      return;
    }
    const container = findViewContainer(card);
    if (!container) return;
    if (this.renderer && this.renderer.el.isConnected && this.container === container) return;
    this.attachTo(container);
  }

  attachTo(container) {
    if (!this.renderer) this.renderer = new SkyRenderer();
    else this.renderer.unmount();
    this.observer.disconnect();
    this.container = container;
    const bg = container.querySelector(":scope > hui-view-background");
    this.renderer.mount(container, bg ? bg.nextSibling : container.firstChild);
    this.observer.observe(container, { childList: true });
    this.renderer.setMode(this.mode());
    if (this.scene) this.renderer.setScene(this.scene);
    else this.refresh();
  }

  detach() {
    this.observer.disconnect();
    if (this.renderer) {
      // drop the renderer rather than keep it for the next attach: its canvases hold GPU memory while referenced
      this.renderer.unmount();
      this.renderer.release();
      this.renderer = null;
    }
    this.container = null;
    const s = document.documentElement.style;
    for (const v of ["--wbg-active", "--wbg-sky-dark", "--wbg-sky-light", "--wbg-reduce-transparency"]) s.removeProperty(v);
  }

  setDevice(patch) {
    this.device = { ...this.device, ...patch };
    writeDevice(this.device);
    if (!this.device.enabled) this.detach();
    else for (const c of this.owners) this.ensureAttached(c);
    this.refresh();
  }

  mode() {
    const d = this.device;
    let animate = d.animations === "on" ? true : d.animations === "off" ? false : !!this.config.animations;
    if (d.animations === "auto" && this.reducedMotion.matches) animate = false;
    return {
      animate,
      quality: d.quality,
      flash: !!this.config.lightning_flash && !this.reducedMotion.matches,
    };
  }

  update(card, hass, config) {
    if (config) this.config = { ...DEFAULTS, ...config };
    this.hass = hass;
    if (card && this.owners.has(card)) this.ensureAttached(card);
    this.refresh();
  }

  readInput() {
    const hass = this.hass;
    const cfg = this.config;
    const now = new Date();
    const input = {
      condition: "partlycloudy",
      elevation: 20,
      moonPhase: moonPhase(now),
      southern: (hass?.config?.latitude ?? 52) < 0,
      latitude: hass?.config?.latitude,
    };
    if (!hass) return input;
    const sun = hass.states[cfg.sun_entity || "sun.sun"];
    if (sun) {
      const el = num(sun.attributes?.elevation);
      input.elevation = el !== undefined ? el : sun.state === "above_horizon" ? 25 : -20;
      input.azimuth = num(sun.attributes?.azimuth);
    }
    const w = cfg.weather_entity && hass.states[cfg.weather_entity];
    if (w) {
      const a = w.attributes || {};
      input.condition = w.state;
      input.coverage = num(a.cloud_coverage);
      let kmh = num(a.wind_speed);
      if (kmh !== undefined) {
        const u = String(a.wind_speed_unit || "km/h").toLowerCase();
        if (u === "m/s") kmh *= 3.6;
        else if (u === "mph") kmh *= 1.609;
        else if (u === "kn" || u === "kt") kmh *= 1.852;
        else if (u === "ft/s") kmh *= 1.097;
      }
      input.windKmh = kmh;
      input.windBearing = num(a.wind_bearing);
      let vis = num(a.visibility);
      if (vis !== undefined && String(a.visibility_unit || "km").toLowerCase() === "mi") vis *= 1.609;
      if (vis !== undefined && String(a.visibility_unit || "km").toLowerCase() === "m") vis /= 1000;
      input.visibility = vis;
      let t = num(a.temperature);
      if (t !== undefined && String(a.temperature_unit || "°C").includes("F")) t = ((t - 32) * 5) / 9;
      input.temperature = t;
    }
    const p = cfg.precipitation_entity && hass.states[cfg.precipitation_entity];
    if (p) {
      let v = num(p.state);
      if (v !== undefined && String(p.attributes?.unit_of_measurement || "").startsWith("in")) v *= 25.4;
      input.precipRate = v;
    }
    const pm = cfg.pm25_entity && hass.states[cfg.pm25_entity];
    if (pm) input.pm25 = num(pm.state);
    const kp = cfg.kp_entity && hass.states[cfg.kp_entity];
    if (kp) input.kp = num(kp.state);
    if (cfg.warning_entity) input.warning = parseWarning(hass.states[cfg.warning_entity]);
    return input;
  }

  stableCondition(cond) {
    const now = Date.now();
    const hyst = Math.max(0, num(this.config.hysteresis) ?? 10) * 60000;
    if (!this.shown || hyst === 0) {
      this.shown = cond;
      this.candidate = null;
      return cond;
    }
    if (cond === this.shown) {
      this.candidate = null;
      return cond;
    }
    if (this.candidate !== cond) {
      this.candidate = cond;
      this.since = now;
    } else if (now - this.since >= hyst) {
      this.shown = cond;
      this.candidate = null;
    }
    return this.shown;
  }

  refresh() {
    const input = this.readInput();
    if (input.condition === "unavailable" || input.condition === "unknown") {
      input.condition = this.shown || "partlycloudy";
    }
    input.condition = this.stableCondition(input.condition);
    // remember when it last rained, for the rainbow
    if (WET.includes(input.condition)) this.lastWet = Date.now();
    input.rainbow = !!this.lastWet && Date.now() - this.lastWet < 30 * 60000;
    const fx = this.sim.effect;
    if (fx === "rainbow") Object.assign(input, { condition: "partlycloudy", coverage: 40, elevation: 14, rainbow: true });
    if (fx === "frost") input.temperature = -8;
    if (fx === "smog") input.pm25 = 160;
    if (fx === "aurora") Object.assign(input, { condition: "clear-night", coverage: 0, elevation: -25, kp: 9 });
    if (fx === "warning") input.warning = 2;
    if (this.sim.condition) {
      input.condition = this.sim.condition;
      if (CONDITIONS[this.sim.condition]) input.coverage = undefined;
    }
    if (this.sim.elevation !== null) input.elevation = this.sim.elevation;
    this.lastInput = input;
    const scene = computeScene(input, this.config);
    scene.southern = input.southern;
    const dark = !!this.hass?.themes?.darkMode;
    scene.dim = dark ? ((num(this.config.dark_dim) ?? 40) / 100) * smooth(0.1, 0.45, scene.skyLum) : 0;
    scene.lift = dark ? 0 : ((num(this.config.light_lift) ?? 10) / 100) * scene.skyDark;
    this.scene = scene;
    if (this.renderer && this.renderer.el.isConnected) {
      this.renderer.setMode(this.mode());
      this.renderer.setScene(scene);
      const s = document.documentElement.style;
      const effDark = dark ? scene.skyDark * (1 - scene.dim) : scene.skyDark * (1 - scene.lift);
      s.setProperty("--wbg-active", "1");
      s.setProperty("--wbg-sky-dark", effDark.toFixed(3));
      s.setProperty("--wbg-sky-light", (1 - effDark).toFixed(3));
      s.setProperty("--wbg-reduce-transparency", this.reducedTransparency.matches ? "1" : "0");
    }
    for (const c of this.owners) c._renderInfo?.();
  }
}

const manager = window.__haWeatherDynamicBackground || (window.__haWeatherDynamicBackground = new Manager());

/* ------------------------------------------------------------------- card */

const CARD_CSS = `
:host{display:block}
.wrap{padding:16px;display:flex;flex-direction:column;gap:10px;font-size:14px;color:var(--primary-text-color)}
.top{display:flex;gap:12px;align-items:center}
.sw{width:44px;height:44px;border-radius:12px;flex:none;box-shadow:inset 0 0 0 1px rgba(127,127,127,.25)}
.t{font-weight:600;font-size:16px}
.s{color:var(--secondary-text-color);font-size:12.5px;line-height:1.4}
.warn{font-size:12.5px;color:var(--secondary-text-color);background:rgba(127,127,127,.12);border-radius:10px;padding:8px 10px}
.sec{margin-top:6px;font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--secondary-text-color)}
.row{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:36px}
select,button{font:inherit;color:inherit;background:var(--secondary-background-color,rgba(127,127,127,.12));border:1px solid var(--divider-color,rgba(127,127,127,.3));border-radius:10px;padding:6px 10px;min-height:36px}
button{cursor:pointer}
input[type=range]{flex:1;max-width:180px}
input[type=checkbox]{width:20px;height:20px}
output{min-width:46px;text-align:right;font-variant-numeric:tabular-nums;color:var(--secondary-text-color)}
`;

class WeatherDynamicBackgroundCard extends HTMLElement {
  static getConfigForm() {
    const t = T(manager.hass);
    return {
      schema: [
        { name: "show_panel", selector: { boolean: {} } },
        { name: "weather_entity", required: true, selector: { entity: { domain: "weather" } } },
        { name: "sun_entity", selector: { entity: { domain: "sun" } } },
        { name: "precipitation_entity", selector: { entity: { domain: "sensor" } } },
        { name: "pm25_entity", selector: { entity: { domain: "sensor" } } },
        { name: "kp_entity", selector: { entity: { domain: "sensor" } } },
        { name: "warning_entity", selector: { entity: { domain: ["binary_sensor", "sensor"] } } },
        {
          type: "grid",
          name: "",
          schema: [
            { name: "animations", selector: { boolean: {} } },
            { name: "lightning_flash", selector: { boolean: {} } },
            { name: "show_moon", selector: { boolean: {} } },
            { name: "show_stars", selector: { boolean: {} } },
            { name: "show_shooting_stars", selector: { boolean: {} } },
            { name: "sun_azimuth", selector: { boolean: {} } },
            { name: "show_rainbow", selector: { boolean: {} } },
            { name: "show_frost", selector: { boolean: {} } },
          ],
        },
        { name: "intensity", selector: { number: { min: 20, max: 200, step: 10, unit_of_measurement: "%", mode: "slider" } } },
        { name: "hysteresis", selector: { number: { min: 0, max: 60, step: 1, unit_of_measurement: "min", mode: "box" } } },
        { name: "dark_dim", selector: { number: { min: 0, max: 80, step: 5, unit_of_measurement: "%", mode: "slider" } } },
        { name: "light_lift", selector: { number: { min: 0, max: 40, step: 5, unit_of_measurement: "%", mode: "slider" } } },
      ],
      computeLabel: (sch) => t.labels[sch.name],
      computeHelper: (sch) => t.helpers[sch.name],
    };
  }

  static getStubConfig(hass) {
    const w = Object.keys(hass?.states || {}).find((e) => e.startsWith("weather."));
    return { weather_entity: w || "" };
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.connectedWhileHidden = true;
    this._preview = false;
    this._config = { ...DEFAULTS };
  }

  // hui-card hides a card whose `hidden` is true but keeps it connected
  // (connectedWhileHidden), so the background keeps running while the card takes no space.
  get _visible() {
    return this._preview || !!this._config.show_panel;
  }

  get hidden() {
    return !this._visible;
  }

  set hidden(v) {
    /* visibility is driven by edit mode and the show_panel option */
  }

  setConfig(config) {
    if (!config) throw new Error("Invalid configuration");
    this._config = { ...DEFAULTS, ...config };
    if (this.isConnected) manager.update(this, this._hass, this._config);
    this._renderPanel();
  }

  set hass(hass) {
    this._hass = hass;
    if (this.isConnected) manager.update(this, hass, this._config);
  }

  get hass() {
    return this._hass;
  }

  set preview(v) {
    this._preview = !!v;
    this._renderPanel();
  }

  get preview() {
    return this._preview;
  }

  set editMode(v) {
    if (v !== undefined) this.preview = v;
  }

  connectedCallback() {
    manager.register(this);
    if (this._hass) manager.update(this, this._hass, this._config);
    this._renderPanel();
  }

  disconnectedCallback() {
    manager.unregister(this);
  }

  getCardSize() {
    return this._visible ? 4 : 0;
  }

  getGridOptions() {
    return { columns: 12, rows: "auto" };
  }

  _renderPanel() {
    if (!this._visible) {
      this.shadowRoot.innerHTML = "";
      this._built = false;
      return;
    }
    if (this._built) {
      this._renderInfo();
      return;
    }
    this._built = true;
    const t = T(this._hass);
    const p = t.panel;
    const opts = Object.keys(CONDITIONS)
      .map((k) => `<option value="${k}">${t.cond[k]}</option>`)
      .join("");
    const fx = Object.entries(p.fx)
      .map(([k, v]) => `<option value="${k}">${v}</option>`)
      .join("");
    this.shadowRoot.innerHTML = `<style>${CARD_CSS}</style>
      <ha-card>
        <div class="wrap">
          <div class="top"><div class="sw" id="sw"></div>
            <div><div class="t">${t.name}</div><div class="s" id="info">…</div></div></div>
          <div class="warn" id="warn" hidden></div>
          <div class="sec">${p.device}</div>
          <label class="row"><span>${p.enabled}</span><input type="checkbox" id="en"></label>
          <label class="row"><span>${p.animations}</span><select id="anim">
            <option value="auto">${p.anim.auto}</option><option value="on">${p.anim.on}</option><option value="off">${p.anim.off}</option></select></label>
          <label class="row"><span>${p.quality}</span><select id="q">
            <option value="auto">${p.q.auto}</option><option value="low">${p.q.low}</option><option value="high">${p.q.high}</option></select></label>
          <div class="sec">${p.preview}</div>
          <label class="row"><span>${p.weather}</span><select id="simc"><option value="">${p.real}</option>${opts}</select></label>
          <label class="row"><span>${p.effect}</span><select id="simfx"><option value="">${p.none}</option>${fx}</select></label>
          <label class="row"><span>${p.sun}</span><input type="range" id="sime" min="-30" max="60" step="1"><output id="simev"></output></label>
          <div class="row"><span class="s">${p.note}</span><button id="simreset">${p.reset}</button></div>
        </div>
      </ha-card>`;
    const $ = (id) => this.shadowRoot.getElementById(id);
    $("en").addEventListener("change", (e) => manager.setDevice({ enabled: e.target.checked }));
    $("anim").addEventListener("change", (e) => manager.setDevice({ animations: e.target.value }));
    $("q").addEventListener("change", (e) => manager.setDevice({ quality: e.target.value }));
    $("simc").addEventListener("change", (e) => {
      manager.sim.condition = e.target.value;
      manager.refresh();
    });
    $("simfx").addEventListener("change", (e) => {
      manager.sim.effect = e.target.value;
      manager.refresh();
    });
    $("sime").addEventListener("input", (e) => {
      manager.sim.elevation = parseFloat(e.target.value);
      manager.refresh();
    });
    $("simreset").addEventListener("click", () => {
      manager.sim = { condition: "", elevation: null, effect: "" };
      manager.refresh();
    });
    this._renderInfo();
  }

  _renderInfo() {
    if (!this._visible || !this._built) return;
    const $ = (id) => this.shadowRoot.getElementById(id);
    const inp = manager.lastInput;
    const sc = manager.scene;
    const t = T(this._hass);
    const pi = t.panel.info;
    if (inp && sc) {
      const parts = [t.cond[inp.condition] || inp.condition, pi.sun(Math.round(inp.elevation))];
      if (inp.coverage !== undefined) parts.push(pi.clouds(Math.round(inp.coverage)));
      if (inp.windKmh !== undefined) parts.push(pi.wind(Math.round(inp.windKmh)));
      if (sc.moon > 0.05) parts.push(pi.moon(Math.round(((1 - Math.cos(2 * Math.PI * inp.moonPhase)) / 2) * 100)));
      if (inp.temperature !== undefined) parts.push(`${Math.round(inp.temperature)}°C`);
      if (inp.pm25 !== undefined) parts.push(`PM2.5 ${Math.round(inp.pm25)}`);
      if (inp.kp !== undefined) parts.push(`Kp ${inp.kp}`);
      if (sc.rainbow > 0.05) parts.push(pi.rainbow);
      if (sc.aurora > 0.05) parts.push(pi.aurora);
      if (inp.warning) parts.push(pi.warning(inp.warning));
      if (manager.candidate) parts.push(pi.waiting(t.cond[manager.candidate] || manager.candidate));
      $("info").textContent = parts.join(" · ");
      $("sw").style.background = sc.gradient;
    }
    const warn = $("warn");
    const msgs = [];
    if (!this._config.weather_entity) msgs.push(t.panel.warnNoEntity);
    else if (this._hass && !this._hass.states[this._config.weather_entity])
      msgs.push(t.panel.warnMissing(this._config.weather_entity));
    if (!manager.device.enabled) msgs.push(t.panel.warnDisabled);
    warn.hidden = !msgs.length;
    warn.textContent = msgs.join(" ");
    const d = manager.device;
    if (this.shadowRoot.activeElement?.id !== "en") $("en").checked = d.enabled;
    $("anim").value = d.animations;
    $("q").value = d.quality;
    $("simc").value = manager.sim.condition;
    $("simfx").value = manager.sim.effect || "";
    const el = manager.sim.elevation ?? Math.round(inp?.elevation ?? 20);
    if (this.shadowRoot.activeElement?.id !== "sime") $("sime").value = el;
    $("simev").textContent = `${Math.round(el)}°${manager.sim.elevation === null ? "" : " *"}`;
  }
}

if (!customElements.get(TAG)) {
  customElements.define(TAG, WeatherDynamicBackgroundCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: TAG,
    name: T().name,
    description: T().description,
    preview: false,
    documentationURL: REPO_URL,
  });
  console.info(`%c HA-WEATHER-DYNAMIC-BACKGROUND-CARD %c ${VERSION} `, "background:#3a7fcf;color:#fff;border-radius:4px 0 0 4px;padding:2px 4px", "background:#1c1c1e;color:#fff;border-radius:0 4px 4px 0;padding:2px 4px");
}


