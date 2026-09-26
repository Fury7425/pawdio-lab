# What changed (PR #49)

This covers everything merged in [PR #49](https://github.com/Fury7425/pawdio-lab/pull/49): an audit of the whole app, then fixes across the measurements, the UI, the backend and the repo. The version number was not changed and is still `1.5.0`.

**Contents**

1. [After you update](#1-after-you-update)
2. [Latency test](#2-latency-test)
3. [Stopping a measurement](#3-stopping-a-measurement)
4. [Sweep FR](#4-sweep-fr)
5. [ANC / Transparency](#5-anc--transparency)
6. [Wireless (Bluetooth) mode](#6-wireless-bluetooth-mode)
7. [Experimental tests](#7-experimental-tests)
8. [Devices and settings](#8-devices-and-settings)
9. [Input monitor, pink noise and SPL](#9-input-monitor-pink-noise-and-spl)
10. [Exports and files](#10-exports-and-files)
11. [Library and comparison](#11-library-and-comparison)
12. [Keyboard shortcuts and navigation](#12-keyboard-shortcuts-and-navigation)
13. [Reliability and internals](#13-reliability-and-internals)
14. [Repo, CI and docs](#14-repo-ci-and-docs)
15. [Known remaining issue](#15-known-remaining-issue)
16. [Tests added](#16-tests-added)

---

## 1. After you update

- **Redo latency calibration.** The old offsets were measured with the broken delay calculation (see §2), and they were stored under the old preset names, so they no longer apply.
- **Redo SPL calibration only if you use a mono mic on a stereo interface.** The level meter used to read that setup 6 dB low (see §9), so a calibration made that way is now off by 6 dB.
- **Old saved settings still load.** That includes the old preset selections, the old bit-depth choice, and device selections saved before names were stored.

---

## 2. Latency test

### The delay calculation was wrong for beep signals

The latency test finds the delay by sliding the recorded sound against the played sound and finding where they match best. Before comparing, it faded the whole recording in and out, which made the middle of the recording count far more than the start.

The real sound usually arrives near the start, because latency is short. So the fade pulled the answer towards the middle:

| Real delay | Beep result (before) | Now |
|---|---|---|
| 5 ms | 138.5 ms | 5.0 ms |
| 20 ms | 150.5 ms | 20.0 ms |
| 60 ms | 183.5 ms | 60.0 ms |
| 200 ms | 298.5 ms | 200.0 ms |

The click preset also broke with background noise at short delays. One test reported 742 ms for a real 20 ms delay.

Calibration could not hide this, because the error changed with the real delay.

**Fix:** there is no fade on either signal any more. The delay is now read from the smooth outline (envelope) of the match rather than its individual wiggles, so it can't lock onto the wrong cycle of a tone.

### New presets: three chirps

The four beeps (200 Hz, 1 kHz, 2 kHz, 5 kHz) and the click are replaced by three chirps. A chirp is a short sweep, and each one covers one octave centred on its frequency:

| Preset | Sweep range |
|---|---|
| 200 Hz Chirp | 141 – 283 Hz |
| 5 kHz Chirp | 3.5 – 7.1 kHz |
| 10 kHz Chirp | 7.1 – 14.1 kHz |

A sweep matches in only one place, so it gives one clear answer. A steady beep looks the same every cycle.

On low-sample-rate devices (for example a 16 kHz Bluetooth headset mic), the top of each chirp is cut to what the device can carry.

### Other latency changes

- **One folder per run.** The per-sound plots, the overall bar chart and the text report used to land in different folders. They now share one.
- **Calibrated numbers in the saved files.** The bar chart and the plot's note box show calibrated values. The line on the plot is labelled "Avg Raw Delay", because it sits on the raw match curve.
- **Calibration:**
  - Stop ends calibration, instead of moving on to the next preset.
  - A stopped preset keeps its old offset rather than saving a partial average.
  - "Calibration complete" only appears when every preset calibrated. Otherwise it says how many did.
  - Selecting no presets now shows a message.
- **CSV export:** the Average and StdDev values now sit under their own column headings. They used to be shifted two columns to the right.
- **Colours match the report.** On-screen colours now use the text report's bands:

  | | Good | Moderate | Poor |
  |---|---|---|---|
  | Delay | ≤ 40 ms | ≤ 80 ms | > 80 ms |
  | Std dev | ≤ 10 ms | ≤ 30 ms | > 30 ms |

- **Frequency field removed.** It did nothing, because each preset sets its own frequency.
- **Enter shortcut** on the Latency page runs the presets you've ticked, the same as the Run Selected button. It used to run a hidden single-signal test.
- **A failure mid-suite** keeps the presets that already finished, so they can still be exported.

---

## 3. Stopping a measurement

**Before:** Stop could not interrupt a recording that was already running. It only took effect between recordings, so for a single long sweep it did nothing.

**Now:** a recording checks for Stop every 20 ms and ends right away. How each test handles a stop:

| Test | What happens on Stop |
|---|---|
| Latency, THD | Keep the iterations or tones already measured. |
| Sweep, ANC | Report "stopped" instead of passing off a partial average as a finished result. |
| Guided sweep session | Ends completely, even while the "Accept this sweep?" or "move the mic" dialog is open. Before, it could not be ended at all except by accepting enough sweeps. |
| ANC guided step | Stays on the same step so you can retry it, as the UI always claimed. |

A stopped run is logged as "stopped" and is not shown as an error.

---

## 4. Sweep FR

- **Files from rejected sweeps are gone.** Every capture attempt, rejected ones included, used to write plots and Squiglink files under the same names, so the per-side files could come from a sweep you discarded. Now captures write nothing, and all plots and Squiglink files are written once, from the accepted sweeps only.
- **Start frequency above 20 kHz no longer crashes.** It used to crash the test thread. The sweep range is now clamped safely.
- **Low sample rates:** the sweep stops at what both devices can carry (0.475 × the lower sample rate, capped at 20 kHz). At 44.1 and 48 kHz it still goes to 20 kHz, so normal results are unchanged.
- **Wireless alignment report kept.** The "Wireless alignment" panel used to disappear after the final result. It is now kept.
- **Silent channel warning.** When one channel of a stereo capture is silent and the other is copied into it, the result shows a warning, and the capture's log message says so too.
- **CSV export** keeps its rows when one side is missing. With both sides present, the file is identical to before.
- **Live pink-noise graph:**
  - It no longer slopes downward about 3 dB per octave for a flat device. That slope came from the pink noise itself and wasn't removed.
  - Its scale labels now say ±20 dB, matching the graph.
- **Exported PNGs** still say "normalized to 500 Hz @ 60 dB" in their title. That is the squig.link convention and is labelled, so it was left as is.
- **Sweep results** record the capture format that was actually used.

---

## 5. ANC / Transparency

- **Curves of different lengths no longer break export.** Attenuation used to fill mismatched lengths with invalid numbers, which the backend rejected. It now only covers frequencies both captures share.
- **Right-ear-only captures export properly.** Before:
  - they wrote no single-mode plot, but still reported one as saved;
  - the combined plot drew an empty line for them.
- **Stopped captures return an error.** A stopped or partial capture no longer advances the guided flow.
- **"Auto" y-axis now fits the data.** It used to be a fixed range.
- **New checkbox:** "Save plots and TXT automatically when a run finishes". The setting existed but had no control.
- **Export All** puts the PNGs and every TXT in one folder.
- **Monitor state:** the input monitor and pink noise now show as stopped in the UI while a capture runs.

---

## 6. Wireless (Bluetooth) mode

- **The drift check can now reject a bad capture.** The allowed timing error was measured against a position already corrected for the drift, so it always came out near 0 ms. It accepted up to about 10% clock drift; real drift is under 0.1%.

  It is now measured against where the end marker would sit with no drift. A 2% drift on a wired device is rejected. Realistic drift still passes.

- **The "Timing error" figure** in the alignment report now shows a real value.

---

## 7. Experimental tests

- **Isolation test deleted.** It recorded "inside" and "outside" back to back, with no chance to move the mic, so it always read about 0 dB. Its results also never appeared on the page, because of a name mismatch.
- **THD:**
  - Tones outside what the device can carry are rejected with a clear message.
  - The description no longer claims it only runs 100 / 1k / 6k Hz.
- **Balance and crosstalk** frequencies are clamped to the device's range.
- **Exports** use the save dialog (see §10).

---

## 8. Devices and settings

### Devices are remembered by name

Devices used to be stored only by their position in the system's device list, and that list reorders when something is plugged in or unplugged. That could silently switch you to a different mic or output.

Now the device name is stored and used first:

- If a device moved in the list, it's found by name.
- If it's gone, the system default is used instead of whatever now sits at its old position.
- The old code that silently picked a device by position is removed.

### Input Bit Depth works

This setting used to be saved and ignored. It now picks the capture format:

| Option | Format |
|---|---|
| Auto | the device's own default (same as before) |
| 16-bit | 16-bit integer |
| 24-bit | 24-bit, in 32-bit integer containers |
| 32-bit | 32-bit float |

- The audio library has no native 24-bit format, so "24-bit" asks for 32-bit containers.
- The list only shows depths your selected input offers.
- If the input doesn't offer the chosen depth, the capture uses the device default and the page shows a warning.
- The choice from the old control carries over automatically.
- As part of this, inputs that deliver 32-bit integer samples can now be recorded at all. They used to fail to open.

### Other device changes

- When a device offers several channel layouts, the app now prefers the device's own default channel count. Before, a stereo mic setup could be opened as mono.
- **Removed:** the Signal Duration and Chunk Size settings. They were saved but never used by any measurement.

---

## 9. Input monitor, pink noise and SPL

- **Level meter:**
  - Silent channels are left out of the level. A mono mic on a stereo interface used to read 6 dB low.
  - Clipping is checked on each channel. Before, a clipped channel next to a quiet one was never flagged.
  - Faster internals: the meter no longer holds up the audio thread while it calculates.
- **Restart reliability:**
  - Quickly stopping and restarting the monitor or pink noise could leave nothing running while the UI said "running". Fixed.
  - The monitor can no longer start during a test.
- **SPL calibration:**
  - It is stored under the real name of your default mic, instead of a shared "System Default Input" slot. Before, a new default mic would reuse the old mic's calibration.
  - "Clipping at" is now "Sine clips at", and it's 3 dB lower. That accounts for a sine wave's peak being 3 dB above its average level.

---

## 10. Exports and files

- **Save dialog.** Exports with no output folder chosen now open a normal Save dialog. They used a browser-style download that the desktop app may silently ignore. This applies to the Experimental, Library and Comparison exports, and to the Sweep, Latency and ANC exports when no folder is set.
- **Folder check.** Output folders you type are checked: they must be full paths with no `..`.
- **Honest messages.** A cancelled save dialog no longer claims the file was exported.

---

## 11. Library and comparison

- **Latency comparison** reads both kinds of saved latency results. Results saved from the Save-to-Library list used to show "—".
- **Old records still show properly.** Records from the removed isolation test, or any other unknown type, show their name instead of a blank heading.
- **No double saves.** The Save button can't save the same measurement twice.
- **Exports** use the save dialog, and export errors are shown instead of silently ignored.

---

## 12. Keyboard shortcuts and navigation

- **Rebinding takes effect immediately.** The settings screen and the key listener used to hold separate copies, so a new binding only worked after restarting the app.
- **Capturing a shortcut** that's already bound no longer also fires it. For example, rebinding Ctrl+1 used to navigate away.
- **Sidebar tooltips** show your real bindings. They used to show hard-coded, partly wrong keys.
- **Page renamed.** "Results / Export" is now "Logs", which is all that page contains.

---

## 13. Reliability and internals

- **Running indicator.** It no longer flickers to "Idle" between the steps of a multi-step run (latency suite, calibration, ANC step). While it did, buttons re-enabled and a second test could collide with the first.
- **Dev mode calibration.** Latency calibration is no longer wiped on every launch in dev mode (`npm run dev:tauri`).
- **Saving settings.** Settings saving now waits for you to stop typing. It used to write on every keystroke.
- **Log size.** The log keeps the last 5,000 lines instead of growing forever.
- **Update check** ignores version suffixes like `-beta.2`, as its own docs promised.
- **Compensation files** only count as six-column "population" files when every row has six columns. Mixed files used to read missing values as 0 dB.
- **Code structure:**
  - All backend calls, event listeners and dialogs now go through `src/ipc/commands.ts`, as CLAUDE.md describes.
  - ANC attenuation maths is shared by the page, the exports and the comparison view (`src/ui/lib/anc.ts`).
  - Unused code removed: the old sweep "rewrite files" commands, `ensure_output_dir`, the untyped test runner and the download helpers.
- **Error text.** Cancel errors now say "measurement cancelled" instead of "latency test cancelled" for every test.

---

## 14. Repo, CI and docs

- **CI format check fixed.** It was failing on `docs/*.html`; `docs/` is now in `.prettierignore`.
- **Bundle workflow** uses `npm ci`.
- **`requirements.txt` removed.** It belonged to the deleted Python prototype.
- **`rand`** moved to dev-dependencies; only tests use it now.
- **Docs updated.** README, CLAUDE.md and AGENTS.md now describe the chirp presets, stopping, sweep exports, device names, bit depth, the current file layout and all localStorage keys. The README roadmap items that were already done are ticked.

---

## 15. Known remaining issue

- **Wireless markers at 8 kHz.** The wireless timing markers use tones up to 7.9 kHz, so they would alias on an 8 kHz link. Redesigning the markers is riskier than the problem, so this was left as is.

---

## 16. Tests added

**Rust** (34 tests total):

- Latency chirps measure known delays (5, 20, 60, 200 ms) at 44.1 and 48 kHz, in the app's real recording layout.
- A short-delay click in noise is measured correctly.
- The chirp band and preset names.
- The pink-noise graph reads flat.
- Level meter: silent channels and per-channel clipping.
- Device lookup by name.
- Safe sweep band clamping.
- The wireless drift budget rejects 2% drift and reports the real timing error.
- The bit-depth setting and format mapping.

**Frontend** (138 tests total):

- Device selection by name.
- Bit-depth migration.
- ANC attenuation.
- Save-path splitting.
- Latency comparison shapes.
- Compensation row widths.
- The sweep alignment report is kept after combining.
- Version suffix handling.
