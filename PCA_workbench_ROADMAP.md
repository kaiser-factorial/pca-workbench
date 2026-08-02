# PCA-Viz Workbench: Execution Roadmap

## Phase 1: Core Web App Development

This phase covers building the foundational app, from data ingestion to the final 3D visualizations and HTML exports. 

### Stage 1: Project Scaffolding & Setup
- `[x]` **Ticket 1.1:** Initialize Next.js project (`pca-workbench/frontend`) with Tailwind CSS for rapid UI styling.
- `[x]` **Ticket 1.2:** Initialize FastAPI project (`pca-workbench/backend`) with standard dependencies (`pandas`, `scikit-learn`, `uvicorn`).
- `[x]` **Ticket 1.3:** Setup CORS and create a basic health-check API route to verify the frontend and backend can communicate.
  - *Verification:* The frontend successfully displays a "Backend Connected" message on load.

### Stage 2: UI Layout & File Upload
- `[x]` **Ticket 2.1:** Build the core UI shell: a control sidebar on the left, and a main visualizer area on the right.
- `[x]` **Ticket 2.2:** Build Drag-and-Drop file upload components for both the **Dataset** and the **PCA Components** files.
- `[x]` **Ticket 2.3:** Wire the upload components to send the files to a backend POST endpoint.
  - *Verification:* Uploading dummy CSVs results in the backend logging their successful receipt.

### Stage 3: Data Processing Engine (Backend)
- `[x]` **Ticket 3.1:** Implement backend logic to parse uploaded files into Pandas DataFrames, handling missing values gracefully.
- `[x]` **Ticket 3.2:** Implement matrix multiplication logic to generate coordinates (PC1, PC2, PC3) by multiplying the Dataset subset by the PCA Components.
- `[x]` **Ticket 3.3:** Stitch the new coordinates back onto the full dataset and return the master payload (plus a list of column names for the attribute dropdowns) to the frontend.
  - *Verification:* The frontend receives a JSON payload containing the full dataset with new PC1/PC2/PC3 columns.

### Stage 4: Visualization Engine (Frontend)
- `[x]` **Ticket 4.1:** Integrate `react-plotly.js` and render the initial 3D Scatter plot using the coordinates.
- `[x]` **Ticket 4.2:** Port the OG Dashboard aesthetic (Z-floor shadows, custom camera angle, `plotly_white` template, transparent background).
- `[x]` **Ticket 4.3:** Implement the "Color By" (Attribute Encoding) dropdown, allowing Plotly to color points dynamically based on the selected dataset column.
- `[x]` **Ticket 4.4:** Implement the auto-rotation toggle button, manipulating the Plotly camera state on an animation frame loop.
  - *Verification:* The visualizer displays a beautiful, rotating 3D plot with shadows, and changing the "Color By" dropdown instantly recolors the points.

### Stage 5: Interactive Clustering & Features
- `[x]` **Ticket 5.1:** Create backend endpoints for DBSCAN and kNN clustering.
- `[x]` **Ticket 5.2:** Add UI sliders for clustering parameters (`eps`, `min_samples`, `k`) that trigger instant backend recalculations and Plotly updates.
- `[x]` **Ticket 5.3:** Implement the "Side-by-Side" lock feature, saving the current Plotly state into a secondary pinned view.
- `[x]` **Ticket 5.4:** Add contextual note-taking areas and axis renaming inputs.
  - *Verification:* Adjusting a slider changes the clustering live. Pinning a view locks it in place alongside the active view.

### Stage 6: Exporting & Polish
- `[x]` **Ticket 6.1:** Implement "Export as Image" (PNG) — plus rotating-GIF export for 3D views (client-side, 36 frames via gifenc).
- `[x]` **Ticket 6.2:** Implement "Export as Interactive HTML" — standalone file with the Plotly bundle inlined (offline-safe), current traces/layout embedded, and a rotation script + pause button for 3D. Vendor bundle copied to `public/vendor/` via `predev`/`prebuild`.
  - *Verification:* Downloaded `.html` renders and rotates in any browser with no app/server (rAF correctly pauses when the tab is backgrounded).

### Stage 7: Persistence (added)
- `[x]` **Workspace save/load:** File-based via backend (`workspaces/` dir, 4 REST endpoints). Save names a snapshot of all datasets, pins, mute states, cluster params, notes, camera; load restores the app exactly. Table registry dedupes shared/snapshotted tables. Seam for a future real backend = those 4 endpoints.
- `[x]` **Cross-dataset column transfer:** Copy a column (e.g. `Cluster`) from one loaded dataset into another so you can color romance-space points by sex-space clusters (or any two datasets sharing respondents). Two alignment modes — by row order (with an automatic sanity check against a stable shared column, deliberately excluding PC/axis scores which differ per dataset) and match by a shared key column (e.g. ParticipantID) for when row order isn't guaranteed. Guards against mismatched row counts and non-unique keys.

---

## Phase 1.5: Scatter Lab — client-side migration & UI overhaul (August 2026)

- `[x]` **Rebrand:** PCA Workbench → **Scatter Lab** (working title, single `APP_NAME` constant). The tool outgrew PCA — any variables can be plotted, projected, clustered.
- `[x]` **Full client-side migration — the Python backend is gone.** Parsing (PapaParse / SheetJS / hyparquet), median imputation + z-scaling + components projection, DBSCAN + K-Means (k-means++, deterministic seeds, `frontend/src/lib/`), and workspace persistence (IndexedDB + file export/import) all run in the browser. Data never leaves the machine — which is the right privacy posture for participant data and makes the app deployable as a static Vercel site.
- `[x]` **Variables panel:** merged Dataset Info + axis pickers into one surface — every column shows type, range/categories, missing count, and a live mini-histogram, with one-click X/Y/Z/C assignment.
- `[x]` **UI polish:** designed empty state with demo-data loader, real drag-and-drop, components upload demoted to an optional toggle, Bauhaus button hierarchy restored (Tailwind v4 layer fix), real webfonts, favicon, numbered section markers, reduced-motion support.
- `[x]` **Deploy:** live at [scatter-lab.vercel.app](https://scatter-lab.vercel.app); GitHub pushes to `main` auto-deploy (Vercel project `scatter-lab`, root directory `frontend`).

---

## Phase 2: The AI Assistant (August 2026)

- `[x]` **In-app assistant panel** (bottom-right, both themes): chat UI with streaming responses, driven by the user's own API key.
- `[x]` **OpenRouter by default, any OpenAI-compatible endpoint supported** — one key works across Claude/GPT/Gemini; the endpoint field also accepts local runtimes (Ollama/LM Studio) for a fully offline assistant. Key lives in localStorage only, never in exported workspaces.
- `[x]` **Tool-driven app control:** the model can read column profiles/app state, set axes & coloring & 2D/3D, run DBSCAN/K-Means, read cluster compositions, and pin views. No destructive tools.
- `[x]` **Privacy contract:** requests carry column metadata and aggregate stats only — raw data rows are never sent; the panel states this under the input.
- `[x]` **Explain-my-upload-error helper wired to validation failures:** a failed upload now offers an "Ask the assistant about this error" chip that hands the assistant the validation message directly, instead of relying on the user to ask.

---

## Phase 2: The AI Assistant (Future)

Once Phase 1 is fully functional and you are actively using it for analysis, we will begin Phase 2. 
- **The Goal:** Embed a conversational AI assistant directly into the app interface.
- **Data Validation:** If a user uploads a malformed file (e.g., mismatched matrix dimensions, unexpected string characters in numeric columns), the app won't just throw a generic red error. The AI agent will intercept the error, analyze the file headers and structure, and explain to the user *exactly* how to fix their Excel file before re-uploading.
- **Site Navigation:** The agent will be given access to the site's state, meaning it can answer questions like "How do I color by Orientation?" or "Why isn't DBSCAN finding any clusters?" and potentially even adjust the sliders for the user via function calling.
- **Implementation:** This will involve hooking up an OpenAI or Gemini API key to a specialized backend route and giving the model a system prompt detailing the app's internal logic.

---

## Development Log & Architecture Notes

### Technical Implementation (Phase 1)
- **Frontend Stack:** Next.js (React), Tailwind CSS, React-Plotly.js.
- **Backend Stack:** FastAPI (Python), Pandas, scikit-learn (KMeans, DBSCAN).
- **Theming & UI Component Architecture:** 
  - Dual-theme system (`primary` Bauhaus vs `terminal` Cyber).
  - Adopted `ccru/components` (`CyberPanel`, `CyberContainer`, `CyberGridGroup`) for the Terminal theme aesthetic.
  - Built custom bespoke components (`PrimaryCollapsible`) to replicate identical UI behaviors (collapsibility, snapping) using Bauhaus styling (hard shadows, sharp borders).
- **Tmux-Style Pinning Layout:**
  - Originally considered `react-resizable-panels`, but opted for a custom raw Flexbox implementation to avoid ESM compiler issues and precisely guarantee the 1-to-4 layout scaling rule.
  - Follows strict Tmux pane splitting logic: [1 View] -> [Split Vertically] -> [Split Right Pane Horizontally] -> [Split Left Pane Horizontally].
- **Absolute Overlays:** 
  - To solve container overflow issues, the Legend and Notes components were decoupled from the Tmux grid. They now float globally over the entire visualization viewport (anchored to `left-0` and `right-0`). 
  - These panels collapse inwards towards the screen edges automatically using `collapseDirection="side"` logic.
