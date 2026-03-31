# Cavity Calcs

Repository for random cavity calculations.

## Scripts

### Simultaneously Resonant Cavity

`simultaneous_cav.py` is a small PyQt6 GUI to visualize the transmission spectra of a 4-mirror traveling-wave ring cavity for two wavelengths.

#### Requirements

- Python 3.9+
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

- `T1`, `T2`, `T3`, `T4`: mirror power transmissions (0 to 1)
- `L coarse (m)`: coarse cavity round-trip length in meters
- `L fine (nm)`: fine length adjustment in nanometers (1 nm step)
- `numFSR`: scan width in free spectral ranges
- `lambda 1 (nm)`, `lambda 2 (nm)`: the two wavelengths to compare
