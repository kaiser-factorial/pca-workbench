# PCA-Viz Workbench: Execution Roadmap

## Phase 1: Core Web App Development

This phase covers building the foundational app, from data ingestion to the final 3D visualizations and HTML exports. 

### Stage 1: Project Scaffolding & Setup
- `[/]` **Ticket 1.1:** Initialize Next.js project (`pca-workbench/frontend`) with Tailwind CSS for rapid UI styling.
- `[/]` **Ticket 1.2:** Initialize FastAPI project (`pca-workbench/backend`) with standard dependencies (`pandas`, `scikit-learn`, `uvicorn`).
- `[ ]` **Ticket 1.3:** Setup CORS and create a basic health-check API route to verify the frontend and backend can communicate.
  - *Verification:* The frontend successfully displays a "Backend Connected" message on load.

### Stage 2: UI Layout & File Upload
- `[ ]` **Ticket 2.1:** Build the core UI shell: a control sidebar on the left, and a main visualizer area on the right.
- `[ ]` **Ticket 2.2:** Build Drag-and-Drop file upload components for both the **Dataset** and the **PCA Components** files.
- `[ ]` **Ticket 2.3:** Wire the upload components to send the files to a backend POST endpoint.
  - *Verification:* Uploading dummy CSVs results in the backend logging their successful receipt.

### Stage 3: Data Processing Engine (Backend)
- `[ ]` **Ticket 3.1:** Implement backend logic to parse uploaded files into Pandas DataFrames, handling missing values gracefully.
- `[ ]` **Ticket 3.2:** Implement matrix multiplication logic to generate coordinates (PC1, PC2, PC3) by multiplying the Dataset subset by the PCA Components.
- `[ ]` **Ticket 3.3:** Stitch the new coordinates back onto the full dataset and return the master payload (plus a list of column names for the attribute dropdowns) to the frontend.
  - *Verification:* The frontend receives a JSON payload containing the full dataset with new PC1/PC2/PC3 columns.

### Stage 4: Visualization Engine (Frontend)
- `[ ]` **Ticket 4.1:** Integrate `react-plotly.js` and render the initial 3D Scatter plot using the coordinates.
- `[ ]` **Ticket 4.2:** Port the OG Dashboard aesthetic (Z-floor shadows, custom camera angle, `plotly_white` template, transparent background).
- `[ ]` **Ticket 4.3:** Implement the "Color By" (Attribute Encoding) dropdown, allowing Plotly to color points dynamically based on the selected dataset column.
- `[ ]` **Ticket 4.4:** Implement the auto-rotation toggle button, manipulating the Plotly camera state on an animation frame loop.
  - *Verification:* The visualizer displays a beautiful, rotating 3D plot with shadows, and changing the "Color By" dropdown instantly recolors the points.

### Stage 5: Interactive Clustering & Features
- `[ ]` **Ticket 5.1:** Create backend endpoints for DBSCAN and kNN clustering.
- `[ ]` **Ticket 5.2:** Add UI sliders for clustering parameters (`eps`, `min_samples`, `k`) that trigger instant backend recalculations and Plotly updates.
- `[ ]` **Ticket 5.3:** Implement the "Side-by-Side" lock feature, saving the current Plotly state into a secondary pinned view.
- `[ ]` **Ticket 5.4:** Add contextual note-taking areas and axis renaming inputs.
  - *Verification:* Adjusting a slider changes the clustering live. Pinning a view locks it in place alongside the active view.

### Stage 6: Exporting & Polish
- `[ ]` **Ticket 6.1:** Implement "Export as Image" (PNG).
- `[ ]` **Ticket 6.2:** Implement "Export as Interactive HTML" by constructing a standalone HTML string with the current data and injecting the OG rotation script.
  - *Verification:* Clicking the export button downloads a `.html` file that can be opened and auto-rotates in any browser without needing the app.

---

## Phase 2: The AI Assistant (Future)

Once Phase 1 is fully functional and you are actively using it for analysis, we will begin Phase 2. 
- **The Goal:** Embed a conversational AI assistant directly into the app interface.
- **Data Validation:** If a user uploads a malformed file (e.g., mismatched matrix dimensions, unexpected string characters in numeric columns), the app won't just throw a generic red error. The AI agent will intercept the error, analyze the file headers and structure, and explain to the user *exactly* how to fix their Excel file before re-uploading.
- **Site Navigation:** The agent will be given access to the site's state, meaning it can answer questions like "How do I color by Orientation?" or "Why isn't DBSCAN finding any clusters?" and potentially even adjust the sliders for the user via function calling.
- **Implementation:** This will involve hooking up an OpenAI or Gemini API key to a specialized backend route and giving the model a system prompt detailing the app's internal logic.
