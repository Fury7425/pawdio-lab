# PawdioLab

PawdioLab is a simple desktop toolkit for measuring and visualising audio latency and frequency response(for now). The application is built with Chatgpt and myself. I uses [CustomTkinter](https://github.com/TomSchimansky/CustomTkinter) and wraps PyAudio utilities to generate test signals, record them and summarise the measure offsets as well as measures the frequency response.

## Features

- **Latency testing presets** – Trigger ready-made impulses and sine sweeps, repeat them automatically, and view key statistics directly in the UI.
- **Frequency response sweeps** – Run logarithmic chirps and inspect magnitude plots from the Sweep FR page.
- **Device management** – Discover input/output devices, supported sample rates, and configure audio hardware prior to running tests.(Currently very buggy and unusable)
- **Results export** – Save per-sound plots, bar charts, and text summaries for later analysis.
- **Experimental labs** – Optional playgrounds for work-in-progress measurements that can be toggled from settings.(THD, Isolation, Channel Balance and such)
