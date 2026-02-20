# ADE Benchmarks (Locked Test Set)

This folder holds the **human-reviewed benchmark dataset** used to validate scoring.

## Goal
- 40 sites total:
  - 10 excellent
  - 10 good
  - 10 average
  - 10 poor

## Rules
- Benchmarks are **manually reviewed**. Add a short justification note.
- Do not change buckets casually. Treat as ground truth.
- Use these for automated validation gates (pairwise ranking checks + distribution targets).

## File
- `sites.json` — the benchmark list.
- `sites.schema.json` — schema.

## TODO
- Replace placeholder entry in `sites.json`.
- Add a CI-ish script to run scans and compute pairwise outranking rate.
