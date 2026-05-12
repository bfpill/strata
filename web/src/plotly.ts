// Use the factory approach to avoid "buffer/" import issues
// @ts-expect-error — plotly.js/dist/plotly has no types
import Plotly from "plotly.js/dist/plotly";
import createPlotlyComponent from "react-plotly.js/factory";

const Plot = createPlotlyComponent(Plotly);
export default Plot;
