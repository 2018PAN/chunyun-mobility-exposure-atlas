# Mobility & Exposure Atlas

An interactive research atlas accompanying a master's thesis on population
activity and PM₂.₅ exposure during the 2018 Chunyun period.

## Views

- Overview
- Spatial Pattern
- Model Comparison
- SHAP Explorer
- Methods & Notes

The site is fully static. Maps, charts, model diagnostics, and SHAP summaries
are rendered in the browser from aggregated research outputs under `Data/`.
No raster map images or external JavaScript libraries are required.

## Local preview

From the repository root, start a temporary local web server:

```powershell
python -m http.server 8000 --bind 127.0.0.1
```

Open `http://127.0.0.1:8000/`, then stop the server with `Ctrl+C` when the
preview is complete.

## GitHub Pages

Publish the repository root with GitHub Pages. The atlas uses hash-based
routes, so no server-side routing or build step is required.

## Citation

Please cite the accompanying master's thesis when using this atlas. Add the
final thesis title, author, institution, and publication year here before the
repository is archived or publicly released.
