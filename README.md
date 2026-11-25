# Puppy Growth Chart Studio

An offline-capable, zero-dependency browser app for tracking puppy height measurements and projecting adult height using biological growth curves.

## Features

- **Multi-Puppy Tracking**: Add, edit, toggle visibility, or remove puppies and their measurements (`Age (Weeks)`, `Height (cm)`, and optional `Note`).
- **Growth Projection Models**:
  - **Gompertz** *(default)*, **Brody (Monomolecular)**, **Logistic**, and **Richards (4-parameter)** nonlinear least-squares fits.
  - **Percentile Track** for puppies with 1–3 measurements using their position within the typical height range band.
  - **Compare All Models** overlay + expandable AICc/$R^2$ comparison table.
- **95% Confidence Band & Growth Velocity**: Optional uncertainty bands and `cm/week` growth rate chart.
- **Save & Reopen Projects**: Autosaves to `localStorage`, supports in-place **Save** / **Open…** via the File System Access API on HTTPS/localhost (with `.puppyproj.json` download/upload/drag-and-drop fallback), and exports CSV.

## Run Locally

Open `index.html` directly in a browser, or run a local static server:

```sh
python3 -m http.server 8000
```

Then visit `http://localhost:8000/index.html`.

## Publish on GitHub Pages

1. Push this repository to GitHub (`main` branch).
2. Open **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**, select **`main`** and **`/ (root)`**, and click **Save**.
4. GitHub Pages will publish your app at `https://<your-username>.github.io/<your-repo>/`.

## Project File Format

Saved projects use `.puppyproj.json` (JSON schema v1) and the **Open…** flow also accepts legacy `{ "Puppy Name": [[week, height], ...] }` dictionaries. A starter file is included in `sample_project.puppyproj.json`.
