import sys

import numpy as np
from PyQt6.QtWidgets import (
    QApplication,
    QDoubleSpinBox,
    QGridLayout,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QVBoxLayout,
    QWidget,
)
from matplotlib.backends.backend_qtagg import FigureCanvasQTAgg as FigureCanvas
from matplotlib.figure import Figure


SPEED_OF_LIGHT = 299792458.0


def ring_cavity_transmission(
    wavelength,
    L,
    T1,
    T2,
    T3,
    T4,
    loss1=0.0,
    loss2=0.0,
    loss3=0.0,
    loss4=0.0,
    extra_roundtrip_loss=0.0,
    n_eff=1.0,
    normalize=True,
):
    """
    Transmission spectrum of a 4-mirror travelling-wave cavity.

    Parameters
    ----------
    wavelength : float or array_like
        Vacuum wavelength(s) in meters.
    L : float
        Round-trip geometric length of the cavity in meters.
    T1, T2, T3, T4 : float
        Power transmissions of the 4 mirrors.
    loss1, loss2, loss3, loss4 : float
        Additional power loss per mirror (scatter/absorption).
    extra_roundtrip_loss : float
        Additional lumped round-trip power loss.
    n_eff : float
        Effective refractive index along the round trip.
    normalize : bool
        If True, return transmission normalized to its maximum.

    Returns
    -------
    T : ndarray
        Power transmission spectrum.
    """
    wavelength = np.asarray(wavelength, dtype=float)

    # Power reflectivities
    R1 = 1.0 - T1 - loss1
    R2 = 1.0 - T2 - loss2
    R3 = 1.0 - T3 - loss3
    R4 = 1.0 - T4 - loss4

    if np.any(np.array([R1, R2, R3, R4]) < 0):
        raise ValueError("Some mirror reflectivities became negative. Check T_i + loss_i <= 1.")

    # Total round-trip power reflectivity
    R_rt = R1 * R2 * R3 * R4 * (1.0 - extra_roundtrip_loss)

    if R_rt < 0 or R_rt > 1:
        raise ValueError("Round-trip power reflectivity must lie between 0 and 1.")

    # Round-trip optical phase
    L_opt = n_eff * L
    phi_rt = 2.0 * np.pi * L_opt / wavelength

    # Choose input/output couplers as mirror 1 and mirror 2
    # You can change this depending on your cavity geometry.
    T = (T1 * T2) / (1.0 + R_rt - 2.0 * np.sqrt(R_rt) * np.cos(phi_rt))

    if normalize:
        Tmax = np.max(T)
        if Tmax > 0:
            T = T / Tmax

    return T


def transmission_vs_detuning_fsr(wavelength_center_m, L, num_fsr, T1, T2, T3, T4):
    if L <= 0:
        raise ValueError("L must be > 0.")
    if num_fsr <= 0:
        raise ValueError("numFSR must be > 0.")
    if wavelength_center_m <= 0:
        raise ValueError("Wavelength must be > 0.")

    points_per_fsr = 1200
    npts = max(2001, int(num_fsr * points_per_fsr) + 1)
    detuning_fsr = np.linspace(-0.5 * num_fsr, 0.5 * num_fsr, npts)

    fsr_hz = SPEED_OF_LIGHT / L
    nu0 = SPEED_OF_LIGHT / wavelength_center_m
    nu_scan = nu0 + detuning_fsr * fsr_hz
    if np.any(nu_scan <= 0):
        raise ValueError("Frequency scan crossed zero. Reduce numFSR or increase wavelength.")

    wavelength_scan = SPEED_OF_LIGHT / nu_scan
    transmission = ring_cavity_transmission(
        wavelength_scan,
        L,
        T1,
        T2,
        T3,
        T4,
        normalize=True,
    )
    return detuning_fsr, transmission


class CavityGui(QWidget):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("4-Mirror Traveling-Wave Cavity")
        self._build_ui()
        self.update_plot()

    def _build_ui(self):
        main_layout = QVBoxLayout()
        form_layout = QGridLayout()

        self.t1_input = self._make_spinbox(
            minimum=0.0, maximum=1.0, value=0.01, decimals=6, step=0.001
        )
        self.t2_input = self._make_spinbox(
            minimum=0.0, maximum=1.0, value=0.01, decimals=6, step=0.001
        )
        self.t3_input = self._make_spinbox(
            minimum=0.0, maximum=1.0, value=0.01, decimals=6, step=0.001
        )
        self.t4_input = self._make_spinbox(
            minimum=0.0, maximum=1.0, value=0.01, decimals=6, step=0.001
        )
        self.length_coarse_input = self._make_spinbox(
            minimum=1e-9, maximum=1e6, value=0.20, decimals=6, step=0.001
        )
        self.length_coarse_input.setSuffix(" m")
        self.length_fine_nm_input = self._make_spinbox(
            minimum=-1e9, maximum=1e9, value=0.0, decimals=0, step=1.0
        )
        self.length_fine_nm_input.setSuffix(" nm")
        self.numfsr_input = self._make_spinbox(
            minimum=0.01, maximum=100.0, value=3.0, decimals=3, step=0.1
        )
        self.lambda1_input = self._make_spinbox(
            minimum=1.0, maximum=1e6, value=780.0, decimals=3, step=0.001
        )
        self.lambda2_input = self._make_spinbox(
            minimum=1.0, maximum=1e6, value=480.0, decimals=3, step=0.001
        )

        form_layout.addWidget(QLabel("T1:"), 0, 0)
        form_layout.addWidget(self.t1_input, 0, 1)
        form_layout.addWidget(QLabel("T2:"), 1, 0)
        form_layout.addWidget(self.t2_input, 1, 1)
        form_layout.addWidget(QLabel("T3:"), 2, 0)
        form_layout.addWidget(self.t3_input, 2, 1)
        form_layout.addWidget(QLabel("T4:"), 3, 0)
        form_layout.addWidget(self.t4_input, 3, 1)
        form_layout.addWidget(QLabel("L coarse (m):"), 4, 0)
        form_layout.addWidget(self.length_coarse_input, 4, 1)
        form_layout.addWidget(QLabel("L fine (nm):"), 5, 0)
        form_layout.addWidget(self.length_fine_nm_input, 5, 1)
        form_layout.addWidget(QLabel("numFSR:"), 6, 0)
        form_layout.addWidget(self.numfsr_input, 6, 1)
        form_layout.addWidget(QLabel("lambda 1 (nm):"), 0, 2)
        form_layout.addWidget(self.lambda1_input, 0, 3)
        form_layout.addWidget(QLabel("lambda 2 (nm):"), 1, 2)
        form_layout.addWidget(self.lambda2_input, 1, 3)

        self.plot_button = QPushButton("Plot")
        self.plot_button.clicked.connect(self.update_plot)
        self._connect_auto_update()

        button_row = QHBoxLayout()
        button_row.addWidget(self.plot_button)
        button_row.addStretch(1)

        self.status_label = QLabel("")
        self.status_label.setStyleSheet("color: #b00020;")

        self.figure = Figure(figsize=(10, 4), tight_layout=True)
        self.canvas = FigureCanvas(self.figure)

        main_layout.addLayout(form_layout)
        main_layout.addLayout(button_row)
        main_layout.addWidget(self.status_label)
        main_layout.addWidget(self.canvas)
        self.setLayout(main_layout)

    @staticmethod
    def _make_spinbox(minimum, maximum, value, decimals, step):
        box = QDoubleSpinBox()
        box.setRange(minimum, maximum)
        box.setDecimals(decimals)
        box.setSingleStep(step)
        box.setKeyboardTracking(True)
        box.setValue(value)
        return box

    def _connect_auto_update(self):
        boxes = [
            self.t1_input,
            self.t2_input,
            self.t3_input,
            self.t4_input,
            self.length_coarse_input,
            self.length_fine_nm_input,
            self.numfsr_input,
            self.lambda1_input,
            self.lambda2_input,
        ]
        for box in boxes:
            box.valueChanged.connect(self.update_plot)

    def update_plot(self):
        try:
            t1 = self.t1_input.value()
            t2 = self.t2_input.value()
            t3 = self.t3_input.value()
            t4 = self.t4_input.value()
            length_coarse_m = self.length_coarse_input.value()
            length_fine_nm = self.length_fine_nm_input.value()
            length_m = length_coarse_m + length_fine_nm * 1e-9
            num_fsr = self.numfsr_input.value()
            lambda1_nm = self.lambda1_input.value()
            lambda2_nm = self.lambda2_input.value()

            det1, trans1 = transmission_vs_detuning_fsr(
                lambda1_nm * 1e-9, length_m, num_fsr, t1, t2, t3, t4
            )
            det2, trans2 = transmission_vs_detuning_fsr(
                lambda2_nm * 1e-9, length_m, num_fsr, t1, t2, t3, t4
            )
        except Exception as exc:
            self.status_label.setText(f"Input error: {exc}")
            return

        self.status_label.setText("")
        self.figure.clear()
        ax = self.figure.add_subplot(1, 1, 1)

        ax.plot(det1, trans1, color="#1f77b4", lw=1.2, label=f"{lambda1_nm:g} nm")
        ax.plot(det2, trans2, color="#d62728", lw=1.2, label=f"{lambda2_nm:g} nm")
        ax.set_title("Transmission Spectra")
        ax.set_xlabel("Detuning (FSR)")
        ax.set_ylabel("Transmission (norm.)")
        ax.set_ylim(0, 1.05)
        ax.grid(alpha=0.25)
        ax.legend()

        self.canvas.draw_idle()


def main():
    app = QApplication(sys.argv)
    window = CavityGui()
    window.resize(1100, 600)
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
