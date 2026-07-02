# Cavity Calcs

Repository for random cavity calculations.

## Scripts

### Simultaneously Resonant Cavity

`simultaneous_cav.py` is a small PyQt6 GUI to visualize the transmission spectra of a traveling-wave ring cavity for two wavelengths.

#### Requirements

- `numpy`
- `matplotlib`
- `PyQt6`

Install dependencies:

```bash
pip install numpy matplotlib PyQt6
```

#### Run

```bash
python simultaneous_cav.py
```

#### Inputs

- `lambda 1 (nm)`, `lambda 2 (nm)`: the two wavelengths to compare
- `lambda 1 mirror T`, `lambda 2 mirror T`: power transmission of the single transmissive mirror at each wavelength
- `L (cm)`: cavity round-trip length in centimeters
- `Scan range (um)`: Scan range around L in micrometers
- `Samples`: number of scan samples; defaults to `1000000`

#### Outputs

- Normalized cavity transmission for both wavelengths plotted against length centered at L
- Overlap of the transmission responses
- Effective cavity kappa at the center length, reported as `kappa / 2pi`
- Finesse for both wavelengths

#### Model

The current implementation uses a lossless Airy model for a ring cavity. The
round-trip field reflectivity `r = sqrt(1 - T)` (set by the mirror power
transmission `T`) fixes the linewidth, and the plotted response is the normalized
cavity transmission lineshape `(1 - r)^2 / |1 - r exp(i phi)|^2`, which peaks at
`1` on resonance and stays in `(0, 1]` (energy-conserving). The other mirrors are
treated as perfect reflectors. The overlap trace is the product of the two
transmission curves after each curve is normalized to its own maximum over the
scan. The effective kappa readout is the
exact Airy FWHM linewidth from the round-trip field reflectivity, converted to
`kappa / 2pi`. The finesse is `FSR / FWHM` using that same exact Airy linewidth.
Both readouts show `n/a` if the resonance is too broad to have a half-maximum
crossing.
