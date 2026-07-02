"""PyQt6 tool for comparing two simultaneous ring-cavity resonances."""

from __future__ import annotations

import sys
from dataclasses import dataclass

import numpy as np
from matplotlib.backends.backend_qtagg import FigureCanvasQTAgg as FigureCanvas
from matplotlib.figure import Figure
from PyQt6.QtCore import Qt
from PyQt6.QtWidgets import (
    QApplication,
    QCheckBox,
    QDoubleSpinBox,
    QFormLayout,
    QGridLayout,
    QGroupBox,
    QLabel,
    QMainWindow,
    QPushButton,
    QSizePolicy,
    QSpinBox,
    QVBoxLayout,
    QWidget,
)


SPEED_OF_LIGHT_M_S = 299_792_458.0


@dataclass(frozen=True)
class CavityParams:
    transmission1: float
    transmission2: float
    lambda1_nm: float
    lambda2_nm: float
    length_m: float
    scan_range_um: float
    points: int


def cavity_response(length_m: np.ndarray, wavelength_nm: float, transmission: float) -> np.ndarray:
    """Normalized Airy transmission for a lossless ring cavity.

    The round-trip field reflectivity ``r = sqrt(1 - T)`` sets the linewidth, and
    the response is the standard cavity transmission lineshape

        (1 - r)^2 / |1 - r exp(i phi)|^2 = 1 / (1 + F_coef sin^2(phi/2)),

    which peaks at 1 on resonance and stays in ``(0, 1]`` (energy-conserving). The
    transmission ``T`` enters only through ``r`` (i.e. through the linewidth).
    """

    round_trip_field = float(np.sqrt(np.clip(1.0 - transmission, 0.0, 1.0)))
    phase = 2.0 * np.pi * length_m / (wavelength_nm * 1e-9)
    denominator = 1.0 + round_trip_field**2 - 2.0 * round_trip_field * np.cos(phase)
    numerator = (1.0 - round_trip_field) ** 2

    return numerator / np.maximum(denominator, np.finfo(float).eps)


def cavity_kappa_rad_s(length_m: float, transmission: float) -> float:
    """Return the exact Airy FWHM linewidth as angular frequency."""

    finesse = cavity_finesse(transmission)
    if length_m <= 0.0 or np.isnan(finesse):
        return np.nan

    linewidth_hz = SPEED_OF_LIGHT_M_S / length_m / finesse
    return 2.0 * np.pi * linewidth_hz


def cavity_finesse(transmission: float) -> float:
    """Return the exact Airy finesse for a single-ended lossless cavity."""

    round_trip_field = float(np.sqrt(np.clip(1.0 - transmission, 0.0, 1.0)))
    if round_trip_field <= 0.0:
        return np.nan

    half_width_argument = (1.0 - round_trip_field) / (2.0 * np.sqrt(round_trip_field))
    if half_width_argument == 0.0:
        return np.inf
    if half_width_argument >= 1.0:
        return np.nan

    return np.pi / (2.0 * np.arcsin(half_width_argument))


def nearest_resonance_offset_um(length_m: float, wavelength_nm: float) -> float:
    """Length offset (um) from L to the nearest resonance (phi = 2 pi n, i.e. L = n lambda)."""

    lam_m = wavelength_nm * 1e-9
    n = round(length_m / lam_m)
    return (n * lam_m - length_m) * 1e6


def scan_quality_notes(params: CavityParams, response1: np.ndarray, response2: np.ndarray) -> list[str]:
    """Warn when the scan grid undersamples a resonance or misses it entirely."""

    step_m = params.scan_range_um * 1e-6 / max(params.points - 1, 1)
    notes: list[str] = []
    per_wavelength = (
        ("lambda 1", params.lambda1_nm, params.transmission1, response1),
        ("lambda 2", params.lambda2_nm, params.transmission2, response2),
    )
    for label, wavelength_nm, transmission, response in per_wavelength:
        finesse = cavity_finesse(transmission)
        if not np.isnan(finesse):
            fwhm_m = wavelength_nm * 1e-9 / finesse
            samples_per_fwhm = fwhm_m / step_m
            if samples_per_fwhm < 10.0:
                notes.append(
                    f"{label} undersampled: ~{samples_per_fwhm:.2g} samples per FWHM; "
                    "increase samples or reduce scan range"
                )
        if float(np.max(response)) < 0.5:
            notes.append(
                f"{label} has no resonance in the scan window "
                f"(max {float(np.max(response)):.3g}); its overlap curve is rescaled from that maximum"
            )
    return notes


def format_scalar(value: float) -> str:
    if np.isnan(value):
        return "n/a"
    if np.isinf(value):
        return "inf"
    return f"{value:.6g}"


def format_rate(rad_per_s: float) -> str:
    if not np.isfinite(rad_per_s):
        return "n/a"

    hz = rad_per_s / (2.0 * np.pi)
    abs_hz = abs(hz)
    if abs_hz >= 1e9:
        return f"{hz / 1e9:.6g} GHz"
    if abs_hz >= 1e6:
        return f"{hz / 1e6:.6g} MHz"
    if abs_hz >= 1e3:
        return f"{hz / 1e3:.6g} kHz"
    return f"{hz:.6g} Hz"


class LabeledDoubleSpinBox(QDoubleSpinBox):
    def __init__(
        self,
        minimum: float,
        maximum: float,
        value: float,
        step: float,
        decimals: int,
        suffix: str = "",
    ) -> None:
        super().__init__()
        self.setRange(minimum, maximum)
        self.setDecimals(decimals)
        self.setValue(value)
        self.setSingleStep(step)
        self.setSuffix(suffix)
        self.setKeyboardTracking(False)
        self.setAlignment(Qt.AlignmentFlag.AlignRight)


class SimultaneousCavityWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("Simultaneously Resonant Cavity")
        self.resize(1120, 760)

        self.figure = Figure(figsize=(8.0, 6.0), constrained_layout=True)
        self.canvas = FigureCanvas(self.figure)
        self.canvas.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)

        self.ax_transmission = None
        self.ax_overlap = None

        controls = self._build_controls()
        summary = self._build_summary()

        left_panel = QWidget()
        left_layout = QVBoxLayout(left_panel)
        left_layout.addWidget(controls)
        left_layout.addWidget(summary)
        left_layout.addStretch(1)

        root = QWidget()
        root_layout = QGridLayout(root)
        root_layout.addWidget(left_panel, 0, 0)
        root_layout.addWidget(self.canvas, 0, 1)
        root_layout.setColumnStretch(0, 0)
        root_layout.setColumnStretch(1, 1)
        self.setCentralWidget(root)

        self._connect_updates()
        self.update_plot()

    def _build_controls(self) -> QGroupBox:
        group = QGroupBox("Inputs")
        form = QFormLayout(group)
        form.setFieldGrowthPolicy(QFormLayout.FieldGrowthPolicy.AllNonFixedFieldsGrow)

        self.transmission_lambda1 = LabeledDoubleSpinBox(0.0, 1.0, 0.042, 0.001, 6)
        self.transmission_lambda2 = LabeledDoubleSpinBox(0.0, 1.0, 0.05, 0.001, 6)
        self.lambda1 = LabeledDoubleSpinBox(1.0, 100000.0, 780.2415, 0.01, 4, " nm")
        self.lambda2 = LabeledDoubleSpinBox(1.0, 100000.0, 479.9970, 0.01, 4, " nm")
        self.length = LabeledDoubleSpinBox(1e-7, 1.0e7, 20.0, 0.005, 9, " cm")
        self.scan_range = LabeledDoubleSpinBox(0.000001, 1.0e6, 1000.0, 0.01, 6, " um")

        self.points = QSpinBox()
        self.points.setRange(200, 10000000)
        self.points.setValue(1000000)
        self.points.setSingleStep(10000)
        self.points.setAlignment(Qt.AlignmentFlag.AlignRight)
        self.points.setKeyboardTracking(False)

        self.overlap_only = QCheckBox("Plot overlap only")

        self.reset_button = QPushButton("Reset")
        self.reset_button.clicked.connect(self.reset_defaults)

        form.addRow("lambda 1", self.lambda1)
        form.addRow("lambda 1 mirror T", self.transmission_lambda1)
        form.addRow("lambda 2", self.lambda2)
        form.addRow("lambda 2 mirror T", self.transmission_lambda2)
        form.addRow("L", self.length)
        form.addRow("Scan range", self.scan_range)
        form.addRow("Samples", self.points)
        form.addRow(self.overlap_only)
        form.addRow(self.reset_button)

        group.setMaximumWidth(300)
        return group

    def _build_summary(self) -> QGroupBox:
        group = QGroupBox("Readout")
        layout = QVBoxLayout(group)
        self.summary_label = QLabel()
        self.summary_label.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
        self.summary_label.setWordWrap(True)
        layout.addWidget(self.summary_label)
        group.setMaximumWidth(300)
        return group

    def _connect_updates(self) -> None:
        controls = (
            self.transmission_lambda1,
            self.transmission_lambda2,
            self.lambda1,
            self.lambda2,
            self.length,
            self.scan_range,
            self.points,
        )
        for control in controls:
            control.valueChanged.connect(self.update_plot)
        self.overlap_only.stateChanged.connect(self.update_plot)

    def reset_defaults(self) -> None:
        self.transmission_lambda1.setValue(0.1)
        self.transmission_lambda2.setValue(0.05)
        self.lambda1.setValue(780.2415)
        self.lambda2.setValue(479.9970)
        self.length.setValue(50.0)
        self.scan_range.setValue(2.0)
        self.points.setValue(1000000)
        self.overlap_only.setChecked(False)

    def params(self) -> CavityParams:
        return CavityParams(
            transmission1=self.transmission_lambda1.value(),
            transmission2=self.transmission_lambda2.value(),
            lambda1_nm=self.lambda1.value(),
            lambda2_nm=self.lambda2.value(),
            length_m=self.length.value() * 1e-2,
            scan_range_um=self.scan_range.value(),
            points=self.points.value(),
        )

    def update_plot(self, *_args: object) -> None:
        params = self.params()
        offsets_um = np.linspace(-0.5 * params.scan_range_um, 0.5 * params.scan_range_um, params.points)
        lengths_m = params.length_m + offsets_um * 1e-6

        response1 = cavity_response(lengths_m, params.lambda1_nm, params.transmission1)
        response2 = cavity_response(lengths_m, params.lambda2_nm, params.transmission2)

        norm1 = normalize(response1)
        norm2 = normalize(response2)
        overlap = norm1 * norm2
        best_index = int(np.argmax(overlap))

        self.figure.clear()
        if self.overlap_only.isChecked():
            self.ax_transmission = None
            self.ax_overlap = self.figure.add_subplot(1, 1, 1)
        else:
            self.ax_transmission = self.figure.add_subplot(2, 1, 1)
            self.ax_overlap = self.figure.add_subplot(2, 1, 2, sharex=self.ax_transmission)

            self.ax_transmission.plot(
                offsets_um,
                response1,
                label=f"lambda 1 = {params.lambda1_nm:g} nm",
                color="#2563eb",
            )
            self.ax_transmission.plot(
                offsets_um,
                response2,
                label=f"lambda 2 = {params.lambda2_nm:g} nm",
                color="#c2410c",
            )
            self.ax_transmission.axvline(offsets_um[best_index], color="#111827", alpha=0.35, linewidth=1.0)
            self.ax_transmission.set_ylabel("Cavity transmission")
            self.ax_transmission.grid(True, alpha=0.25)
            self.ax_transmission.legend(loc="upper right")

        self.ax_overlap.plot(offsets_um, overlap, color="#15803d", label="Normalized overlap")
        self.ax_overlap.axvline(offsets_um[best_index], color="#111827", alpha=0.35, linewidth=1.0)
        self.ax_overlap.scatter([offsets_um[best_index]], [overlap[best_index]], color="#15803d", s=28, zorder=3)
        self.ax_overlap.set_xlabel("Round-trip length offset from L (um)")
        self.ax_overlap.set_ylabel("Overlap")
        self.ax_overlap.set_ylim(bottom=-0.02, top=max(1.05, float(np.max(overlap)) * 1.08))
        self.ax_overlap.grid(True, alpha=0.25)
        self.ax_overlap.legend(loc="upper right")

        self._update_summary(params, offsets_um, response1, response2, overlap, best_index)
        self.canvas.draw_idle()

    def _update_summary(
        self,
        params: CavityParams,
        offsets_um: np.ndarray,
        response1: np.ndarray,
        response2: np.ndarray,
        overlap: np.ndarray,
        best_index: int,
    ) -> None:
        best_offset = float(offsets_um[best_index])
        best_length = params.length_m + best_offset * 1e-6
        peak1_offset_um = nearest_resonance_offset_um(params.length_m, params.lambda1_nm)
        peak2_offset_um = nearest_resonance_offset_um(params.length_m, params.lambda2_nm)
        center_response1 = cavity_response(np.array([params.length_m]), params.lambda1_nm, params.transmission1)[0]
        center_response2 = cavity_response(np.array([params.length_m]), params.lambda2_nm, params.transmission2)[0]
        kappa1 = cavity_kappa_rad_s(params.length_m, params.transmission1)
        kappa2 = cavity_kappa_rad_s(params.length_m, params.transmission2)
        finesse1 = cavity_finesse(params.transmission1)
        finesse2 = cavity_finesse(params.transmission2)

        notes = scan_quality_notes(params, response1, response2)
        notes_text = "\n\nWarnings\n" + "\n".join(notes) if notes else ""

        self.summary_label.setText(
            "Center length\n"
            f"lambda 1 transmission: {center_response1:.6g}\n"
            f"lambda 1 kappa/2pi: {format_rate(kappa1)}\n"
            f"lambda 1 finesse: {format_scalar(finesse1)}\n"
            f"lambda 2 transmission: {center_response2:.6g}\n"
            f"lambda 2 kappa/2pi: {format_rate(kappa2)}\n"
            f"lambda 2 finesse: {format_scalar(finesse2)}\n\n"
            "Best simultaneous point\n"
            f"offset: {best_offset:.6g} um\n"
            f"L: {best_length * 100.0:.12g} cm\n"
            f"lambda 1 transmission: {response1[best_index]:.6g}\n"
            f"lambda 2 transmission: {response2[best_index]:.6g}\n"
            f"overlap: {overlap[best_index]:.6g}\n\n"
            "Individual nearest maxima\n"
            f"lambda 1 offset: {peak1_offset_um:.6g} um\n"
            f"lambda 2 offset: {peak2_offset_um:.6g} um"
            f"{notes_text}"
        )


def normalize(values: np.ndarray) -> np.ndarray:
    maximum = float(np.max(values))
    if maximum <= 0.0:
        return np.zeros_like(values)
    return values / maximum


def main() -> int:
    app = QApplication(sys.argv)
    window = SimultaneousCavityWindow()
    window.show()
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())
