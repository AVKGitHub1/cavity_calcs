# Ring Cavity Explorer

A self-contained website for a four-mirror traveling-wave cavity, matching the
reference screenshot's controls, power and decay-rate plots, scan slider, and
six result cards. Adds selectable input/output ports and a wavelength input
(780 nm by default). One mirror is scanned at a time. Length is the full
geometric round-trip path.

## Run

Open `index.html` directly in a modern browser. No installation, build, network
connection, or backend is needed to use the calculator.

Alternatively, from the repository root:

```powershell
python -m http.server 8000 --bind 127.0.0.1 --directory cavity_power_calcs
```

Then open <http://localhost:8000>.

## Controls

- Enter mirror power transmissions and additional round-trip loss in ppm
  (1,000 ppm = 0.1%).
- Choose any input mirror, a distinct output mirror, and one mirror to scan.
  Selecting the current output as input swaps the output to the previous input.
- Set the scan endpoints and tick spacing. Up to 60 tick intervals are allowed;
  on narrow screens some labels are omitted to keep them legible.
- Drag the slider, use its arrow keys (Shift for larger steps), or click a plot
  to select a transmission. Hover a plot for its numerical values.
- Changing the scan range clamps the current point into the range. Selecting
  or editing a scanned mirror outside the range expands the range to include
  its transmission, increasing tick spacing if necessary.
- Invalid fields display an error, dim the last valid results, and disable
  plot/slider interaction until corrected.

## Physics and conventions

The screenshot uses a **high-finesse, small-loss approximation**, with a
resonant continuous-wave input, perfect mode matching, and no counterpropagating
mode. This calculator reproduces that model rather than silently replacing it
with a different exact round-trip model.

Let `Ti` be each mirror's power transmission, `A` the other round-trip power
loss (all converted from ppm), `S = T1 + T2 + T3 + T4 + A`, and
`tau = ng * L / c`, where `c = 299792458 m/s`.

| Quantity | Formula |
| --- | --- |
| Circulating / incident power | `4 Tin / S²` |
| Net coupled / incident power | `4 Tin (S - Tin) / S²` |
| Output / incident power | `4 Tin Tout / S²` |
| Output leakage per pass | `Tout` |
| Total energy decay rate, kappa | `S / tau` |
| Output energy decay rate, kappa_ext | `Tout / tau` |
| Plotted decay rates (Hz) | `kappa / (2 pi)`, `kappa_ext / (2 pi)` |
| Free spectral range | `1 / tau` |
| Finesse | `2 pi / S` |
| Output escape share | `Tout / S` |
| Optical frequency | `c / wavelength` |
| Quality factor | `(c / wavelength) / (kappa / (2 pi))` |

Here kappa is the **energy** decay rate; the field decays at kappa/2. Literature
also uses kappa for the field decay rate, so check conventions when comparing.
The resonant input-output and critical-coupling relations are discussed in
[Hinney et al., Nature Communications (2024)](https://www.nature.com/articles/s41467-024-46908-2).
That paper uses the field-decay convention; the table above defines this app's
convention explicitly.

Input and output must be distinct mirrors. At the input port, prompt reflection
interferes with cavity leakage, so `Tout * circulating power` would not describe
the measured total power there.

Wavelength changes the optical frequency and Q, displayed in the wavelength
hint and expandable model notes. It does not change the plotted quantities at
fixed transmissions and group index, because the drive is assumed to remain on
resonance. The app does not infer material dispersion or detuning from length.

The app warns if the scan exceeds 10% summed round-trip loss, where this
approximation becomes less reliable. This threshold is a caution, not an error
bound. A completely closed, initially empty cavity has zero driven power,
infinite finesse/Q, and undefined escape share.

Default settings reproduce: 32.53% net coupled power, 1% output leakage,
31.89x circulating power, 2.496 MHz total kappa/2pi, 2.228 MHz output
kappa_ext/2pi, 1.4 GHz FSR, and finesse 561.

## Development and checks

The site uses plain HTML, CSS, JavaScript, and responsive SVG plots. Browser
runtime dependencies: none. `cavity-model.js` is shared by the UI and Node tests.

```powershell
npm test
npm ci
npm run test:browser
```

The physics tests need only Node (18 or newer). Browser checks need Node 20 or
newer, Playwright, and installed Google Chrome; set `CHROME_PATH` to a Chromium executable if
needed. Checks cover the screenshot values, energy conservation, critical
coupling, all port choices, wavelength/length scaling, singular cases, form
validation, slider and plot interactions, and mobile layouts. Preview screenshots
are written to the repository's ignored `.cache/cavity-preview/` directory.
