# Product

## Register

product

(The desktop app is the primary surface. `docs/index.html`, the GitHub Pages landing, is a brand surface and may diverge from the app's token system; the owner has explicitly allowed this.)

## Users

Headphone and IEM enthusiasts, measurement hobbyists (Squiglink community), and developers who want to verify audio gear claims with real data. They arrive from GitHub, Reddit, or Head-Fi links and decide within seconds whether the tool looks legitimate. They trust graphs and distrust marketing.

## Product Purpose

Pawdio Lab is a free, open-source Tauri desktop app that measures latency, frequency response, THD, crosstalk, channel balance, isolation, and per-frequency ANC attenuation using a Rust DSP engine. Success: an enthusiast downloads it, measures their own gear, and exports curves they can share (Squiglink text, PNG, CSV).

## Brand Personality

Calibrated, hands-on, candid. A bench instrument with a paw print: rigorous measurement culture plus a small playful animal identity (the "Pawdio" name, the paw icon). Never overclaims.

## Anti-references

- Fabricated or beautified data. The hero chart arrays and library-tile curves are REAL sweeps exported from the app (clone 711 coupler) and must never be regenerated, rounded, or replaced. Illustrative graphics must be labeled as diagrams.
- Generic dark dev-tool SaaS landing (navy + blue glow + mono everywhere).
- Marketing superlatives ("revolutionary", "studio-grade").

## Design Principles

1. Show the instrument's real output; the data is the hero.
2. Label honesty explicitly: measured vs diagram, validated vs in-progress.
3. Motion explains (draw-in, scan sweep) or gives feedback; never decorates idle.
4. The website may have its own voice; the app keeps its flat-matte token system.
5. Every interactive element works with keyboard, touch, and screen readers.

## Accessibility & Inclusion

WCAG AA contrast (4.5:1 small text), full keyboard support for the interactive chart (arrow keys + live region), `prefers-reduced-motion` alternatives for all animation, hover effects gated behind `(hover: hover)`.
