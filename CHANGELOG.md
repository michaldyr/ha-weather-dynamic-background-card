# Changelog

## Unreleased

### Fixes
- Leaving the dashboard view now frees the background's canvases. The renderer was kept for the life of the page, so its full-screen layers and sprites held GPU memory after the view was left (about 165 MB on a 1920x1200 Fire HD 10). The next visit builds a fresh renderer, which regenerates the cloud decks.

## 1.6.0 – first public release

### Sky
- Sky colours follow the sun's elevation continuously: night, blue hour, dawn, golden hour, day.
- The sun's glow follows its azimuth.

### Clouds
- Cloud deck: soft, mottled stratocumulus at the top of the sky that thins out downwards.
  - Two layers drift with the wind at different speeds.
  - Cloud cover controls how dense the deck is and how low it reaches.
- Cloud colours follow the sky: white on blue, grey when overcast, dark in rain, blue-grey at night.
- Clouds glow warm at golden hour, light up with lightning and hide the moon.
- Cloud textures are generated procedurally a few rows at a time, so the page never stalls.

### Weather effects
- Rain in three depth layers. In rain, drops land on the "glass"; the larger ones run down and leave droplets behind.
- Snow with large out-of-focus flakes in the foreground.
- Hail.
- Thunderstorms with lightning bolts and sky flashes.
- Fog as flat, soft, drifting banks.

### Night
- Twinkling stars and occasional shooting stars.
- The moon in its real phase, computed astronomically; mirrored in the southern hemisphere.

### Extras
- Rainbow after rain when the sun is low.
- Frost on the screen edges below 0 °C.
- Optional smog (PM2.5 sensor).
- Optional aurora (Kp index), shown only during geomagnetic storms strong enough for your latitude.
- Optional weather-warning glow.

### Behaviour
- Light and dark theme correction: bright skies are dimmed in dark mode and dark skies lifted in light mode.
- Scene-change delay (hysteresis), followed by a cross-fade between scenes.
- CSS variables (`--wbg-sky-dark`, `--wbg-sky-light`, `--wbg-active`, `--wbg-reduce-transparency`) for themes.

### Settings and preview
- Per-device settings stored in the browser: background on/off, animations and quality.
- Scene preview: force any weather state, effect and sun elevation.
- `show_panel` keeps the settings panel visible outside edit mode.

### Accessibility and performance
- Respects *Reduce motion* and *Reduce transparency*.
- Pauses when the tab is hidden.
- Adapts quality automatically on slow devices.

### Interface
- Card type `custom:ha-weather-dynamic-background-card`, shown as **HA Weather Dynamic Background** in the card picker.
- Installed with HACS as a custom repository (type Dashboard).
- English and Polish UI, chosen from the Home Assistant language.
- Visual editor.
- Single JavaScript file with no dependencies.
- Loads whether added as a module or a classic script.
