"use client";

// Prebuilt minified partial bundle (scatter, scatter3d, mesh3d, surface) —
// avoids compiling the full 96MB plotly.js source in dev.
import Plotly from "plotly.js-gl3d-dist-min";
import createPlotlyComponent from "react-plotly.js/factory";

const Plot: React.ComponentType<any> = createPlotlyComponent(Plotly);

export default Plot;
