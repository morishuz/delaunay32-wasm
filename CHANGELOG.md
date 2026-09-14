# Changelog

## 0.2.0 - 2026-09-14

- Upgrade the pinned Delaunay32 core from 0.6.2 to 0.7.0 (`d5c10aa`).
- Include upstream polygon clipping, sampling, and quantization fixes, plus serial sorting, polygon validation, and full-result export optimizations.
- Rebuild WebAssembly and regenerate the bundled demo. The JavaScript API remains unchanged.
- Seeded sparse multi-domain samples can differ from earlier releases; reproducibility is scoped to a native library release.
- Add sync and worker browser regressions for clipping around standalone constraint loops, rejection of overflowing quantization scales, and instance reuse after errors.

Validation: 56 browser tests passed across Chromium, Firefox, and WebKit, with four intentional skips. Package asset checks and clean vanilla ESM and Vite consumer tests passed.
