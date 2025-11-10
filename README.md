# PawdioLab

PawdioLab is a simple desktop toolkit for measuring and visualising audio latency and frequency response(for now). The application is built with Chatgpt and myself. It uses CustomTkinter and wraps PyAudio utilities to generate test signals, record them and summarise the measure offsets as well as measures the frequency response.

## Features

- **Latency testing presets** – Trigger ready-made impulses and sine sweeps, repeat them automatically, and view key statistics directly in the UI.
- **Frequency response sweeps** – Run logarithmic chirps and inspect magnitude plots from the Sweep FR page.
- **Device management** – Discover input/output devices, supported sample rates, and configure audio hardware prior to running tests.(Currently very buggy and unusable)
- **Results export** – Save per-sound plots, bar charts, and text summaries for later analysis.
- **Experimental labs** – Optional playgrounds for work-in-progress measurements that can be toggled from settings.(THD, Isolation, Channel Balance and such)

## Appearance & theming

You can adjust PawdioLab's look and feel from the **Devices / Settings** page. The **Appearance** dropdown switches between Dark, Light, and System modes, while the **Accent** dropdown selects one of the bundled colour themes (Greyscale, Blue, Teal, Purple). Changes apply immediately across the app and are stored in `~/.pawdiolab/theme.json` so your preferred styling loads automatically next time you launch PawdioLab.
