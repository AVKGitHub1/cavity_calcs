# Ring Cavity Explorer

A self-contained website for a four-mirror traveling-wave cavity, with power
and decay-rate plots, a scan slider, and six result cards. It uses exact
round-trip interference, selectable input/output ports, a resonance wavelength
input (780 nm by default), and signed laser detuning (0 MHz by default). One
mirror is scanned at a time. Length is the full geometric round-trip path.

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
  Light follows the cyclic order `1 -> 2 -> 3 -> 4 -> 1`. Additional loss is
  lumped immediately before the light returns to the chosen input mirror.
- Set the scan endpoints and tick spacing. Up to 60 tick intervals are allowed;
  on narrow screens some labels are omitted to keep them legible.
- Set laser detuning in MHz: `f_laser - f_resonance`. Positive values place the
  laser above resonance; negative values place it below. Zero restores the
  resonant result. Detuning stays fixed throughout the mirror-transmission scan.
  The circulating-power card also shows the fraction of resonant power at the
  current scan point.
- Drag the slider, use its arrow keys (Shift for larger steps), or click a plot
  to select a transmission. Hover a plot for its numerical values.
- Changing the scan range clamps the current point into the range. Selecting
  or editing a scanned mirror outside the range expands the range to include
  its transmission, increasing tick spacing if necessary.
- Invalid fields display an error, dim the last valid results, and disable
  plot/slider interaction until corrected.

## Physics and conventions

The calculator uses **exact round-trip interference**, with continuous-wave
input, perfect mode matching, one traveling direction, and frequency-independent
mirror transmissions and group index. It supports transmissions from zero to
100%, and includes repeated longitudinal resonances through the round-trip phase.

Let `Ti` be each mirror's power transmission, `Ri = 1 - Ti`, and `A` the
additional power loss (all converted from ppm). Define:

- `tau = ng * L / c`, with `c = 299792458 m/s` and `FSR = 1 / tau`.
- `p = (1 - A) R1 R2 R3 R4`: round-trip power survival.
- `rho = sqrt(p)`: round-trip field survival.
- `b = (1 - A) product(Ri for i != input)`: survival from just after input
  to just before returning to input.
- `df = f_laser - f_resonance` in Hz; the MHz input is multiplied by `1e6`.
- `phi = 2 pi df / FSR` and `D = (1 - rho)² + 4 rho sin²(phi / 2)`.
- `gout`: product of the reflectivities of mirrors encountered between input
  and output. For the immediately next mirror, `gout = 1`.

| Quantity | Formula |
| --- | --- |
| Circulating / incident power, just after input | `Tin / D` |
| Net coupled / incident power | `Tin (1 - b) / D` |
| Output / incident power | `Tin gout Tout / D` |
| Measured input-port power / incident | `1 - net coupled / incident` |
| Output leakage per pass, relative to local power | `Tout` |
| Round-trip energy decay rate, kappa | `-ln(p) / tau` |
| Selected mirror log-loss contribution, kappa_ext | `-ln(Rout) / tau` |
| Plotted decay rates (Hz) | `kappa / (2 pi)`, `kappa_ext / (2 pi)` |
| Free spectral range | `1 / tau` |
| Airy power FWHM | `(2 FSR / pi) asin((1 - rho) / (2 sqrt(rho)))`, when defined |
| Finesse | `FSR / Airy FWHM` |
| Round-trip output escape share | `gout Tout / (1 - p)` |
| Resonance frequency | `c / wavelength` |
| Laser frequency | `c / wavelength + df` |
| Ring-down quality factor | `(c / wavelength) / (kappa / (2 pi))`, for nonzero survival |

Here kappa describes the **energy** envelope sampled once per round trip;
the field-envelope rate is kappa/2. Mirror logarithmic contributions and
`-ln(1 - A) / tau` add to kappa. The escape share instead counts the fraction
of power, starting just after input, that eventually leaves through the selected
output during free propagation. At large losses it depends on mirror order and
is not `kappa_ext / kappa`. The selected mirror's log-loss contribution does not
indicate how much driven power reaches that mirror.

Airy FWHM and `kappa / (2 pi)` coincide only in the high-finesse limit.
If `(1 - rho) / (2 sqrt(rho)) > 1`, the spectral response never falls to half
its peak between resonances, so FWHM and finesse are undefined. The distinction
between Airy and decay linewidths at low reflectivity is treated in
[Ismail et al., Optics Express (2016)](https://doi.org/10.1364/OE.24.016366).

The response is even in detuning and repeats every FSR; detuning by half the
Airy FWHM halves the power when that width exists. Each scan point uses its own
round-trip survival. Detuning does not change decay rates, FSR, finesse, quality
factor, or escape share. Sampling includes narrow and detuning-shifted peaks.

Input and output must be distinct mirrors. At the input port, prompt reflection
interferes with cavity leakage, so `Tout * circulating power` would not describe
the measured total power there.

Resonance wavelength changes the reference optical frequency and Q, displayed
in the wavelength hint and expandable model notes. It does not change the
plotted quantities at fixed transmissions, group index, and detuning. The app
does not infer material dispersion, longitudinal mode number, or detuning from
length. At nonzero detuning, length and group index change the round-trip phase.
The loss-placement assumption matters at large losses: no additional attenuation
is applied before output, but intervening mirror transmissions reduce its power.

At **1,000,000 ppm on all mirrors**, all incident power enters the input and
exits the immediately next mirror, at any detuning (including 1500 MHz). Later
ports receive zero power. Circulating power just after input is 1x incident;
there is no resonant buildup. Zero round-trip survival makes logarithmic decay
rates infinite; the plots omit these values and explain why. Finesse and Q are
undefined. A completely closed, initially empty cavity has zero driven power,
infinite finesse/Q, and undefined escape share.

At small losses and near resonance this reduces to the earlier Lorentzian
approximation with `S = sum(Ti) + A` and circulating power `4 Tin / S²` on
resonance. The exact default readouts are slightly different: 32.41% net coupled
power, 1% local output leakage, 31.78x circulating power, 2.507 MHz total
kappa/2pi, 2.239 MHz output kappa_ext/2pi, 1.4 GHz FSR, and finesse 558.

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
needed. Checks cover exact default powers, the fully transparent limit at
1500 MHz, sequential output powers, energy conservation, critical coupling,
periodic detuning and half-linewidth suppression, shifted scan peaks,
all port choices, wavelength/length scaling, infinite and undefined values, form
validation, slider and plot interactions, and mobile layouts. Preview screenshots
are written to the repository's ignored `.cache/cavity-preview/` directory.
