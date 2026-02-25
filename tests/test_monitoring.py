"""Tests for energy and thermal monitoring modules."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from bloomfl.monitoring.energy import EnergyMonitor, EnergyState
from bloomfl.monitoring.thermal import ThermalMonitor, ThermalState


class TestEnergyMonitor:
    def test_returns_valid_state(self):
        monitor = EnergyMonitor()
        state = monitor.get_state()
        assert isinstance(state, EnergyState)

    def test_high_state_when_no_battery(self):
        monitor = EnergyMonitor()
        with patch("bloomfl.monitoring.energy.psutil.sensors_battery", return_value=None):
            assert monitor.get_state() == EnergyState.HIGH

    def test_high_state_when_plugged_in(self):
        monitor = EnergyMonitor()
        mock_battery = MagicMock()
        mock_battery.power_plugged = True
        mock_battery.percent = 50.0
        with patch("bloomfl.monitoring.energy.psutil.sensors_battery", return_value=mock_battery):
            assert monitor.get_state() == EnergyState.HIGH

    def test_high_state_high_battery(self):
        monitor = EnergyMonitor()
        mock_battery = MagicMock()
        mock_battery.power_plugged = False
        mock_battery.percent = 80.0
        with patch("bloomfl.monitoring.energy.psutil.sensors_battery", return_value=mock_battery):
            assert monitor.get_state() == EnergyState.HIGH

    def test_medium_state(self):
        monitor = EnergyMonitor(low_threshold=20.0, critical_threshold=10.0)
        mock_battery = MagicMock()
        mock_battery.power_plugged = False
        mock_battery.percent = 35.0
        with patch("bloomfl.monitoring.energy.psutil.sensors_battery", return_value=mock_battery):
            assert monitor.get_state() == EnergyState.MEDIUM

    def test_low_state(self):
        monitor = EnergyMonitor(low_threshold=20.0, critical_threshold=10.0)
        mock_battery = MagicMock()
        mock_battery.power_plugged = False
        mock_battery.percent = 15.0
        with patch("bloomfl.monitoring.energy.psutil.sensors_battery", return_value=mock_battery):
            assert monitor.get_state() == EnergyState.LOW

    def test_critical_state(self):
        monitor = EnergyMonitor(low_threshold=20.0, critical_threshold=10.0)
        mock_battery = MagicMock()
        mock_battery.power_plugged = False
        mock_battery.percent = 5.0
        with patch("bloomfl.monitoring.energy.psutil.sensors_battery", return_value=mock_battery):
            assert monitor.get_state() == EnergyState.CRITICAL

    def test_invalid_thresholds(self):
        with pytest.raises(ValueError):
            EnergyMonitor(low_threshold=5.0, critical_threshold=20.0)

    def test_cpu_freq_ratio_range(self):
        monitor = EnergyMonitor()
        ratio = monitor.cpu_freq_ratio()
        assert 0.0 <= ratio <= 1.0

    def test_summary_returns_dict(self):
        monitor = EnergyMonitor()
        summary = monitor.summary()
        assert isinstance(summary, dict)
        assert "energy_state" in summary


class TestThermalMonitor:
    def test_returns_valid_state(self):
        monitor = ThermalMonitor()
        state = monitor.get_state()
        assert isinstance(state, ThermalState)

    def test_normal_when_no_sensors(self):
        """If sensors return nothing, state should be UNKNOWN."""
        monitor = ThermalMonitor()
        with patch("bloomfl.monitoring.thermal.psutil.sensors_temperatures", return_value={}):
            with patch("bloomfl.monitoring.thermal._SYSFS_THERMAL") as mock_sysfs:
                mock_sysfs.exists.return_value = False
                state = monitor.get_state()
        assert state == ThermalState.UNKNOWN

    def test_normal_below_warm(self):
        monitor = ThermalMonitor(warm_threshold=70.0, hot_threshold=80.0, critical_threshold=90.0)
        with patch.object(monitor, "cpu_temperature", return_value=60.0):
            assert monitor.get_state() == ThermalState.NORMAL

    def test_warm_state(self):
        monitor = ThermalMonitor()
        with patch.object(monitor, "cpu_temperature", return_value=75.0):
            assert monitor.get_state() == ThermalState.WARM

    def test_hot_state(self):
        monitor = ThermalMonitor()
        with patch.object(monitor, "cpu_temperature", return_value=85.0):
            assert monitor.get_state() == ThermalState.HOT

    def test_critical_state(self):
        monitor = ThermalMonitor()
        with patch.object(monitor, "cpu_temperature", return_value=95.0):
            assert monitor.get_state() == ThermalState.CRITICAL

    def test_none_temperature_returns_unknown(self):
        monitor = ThermalMonitor()
        with patch.object(monitor, "cpu_temperature", return_value=None):
            assert monitor.get_state() == ThermalState.UNKNOWN

    def test_invalid_thresholds(self):
        with pytest.raises(ValueError, match="warm < hot < critical"):
            ThermalMonitor(warm_threshold=90.0, hot_threshold=80.0, critical_threshold=70.0)

    def test_psutil_sensor_reading(self):
        monitor = ThermalMonitor()
        mock_entry = MagicMock()
        mock_entry.current = 65.0
        mock_entry.high = 90.0
        mock_entry.critical = 100.0
        with patch("bloomfl.monitoring.thermal.psutil.sensors_temperatures",
                   return_value={"coretemp": [mock_entry]}):
            temp = monitor.cpu_temperature()
        assert temp == 65.0

    def test_summary_dict(self):
        monitor = ThermalMonitor()
        summary = monitor.summary()
        assert isinstance(summary, dict)
        assert "thermal_state" in summary
        assert "cpu_temperature_c" in summary
