import logging
from typing import Any

from nanobot.agent.tools.base import Tool
from app.agent.chart import generate_chart
from app.context import current_data, current_viz_data, current_progress_callback
from fastapi.encoders import jsonable_encoder

logger = logging.getLogger(__name__)

class VisualizationTool(Tool):
    """
    Tool for generating a visualization (chart) from existing data.
    """

    @property
    def name(self) -> str:
        return "visualization"

    @property
    def description(self) -> str:
        return (
            "Generate a chart or visualization based on the most recently queried data. "
            "Use this tool when the user asks to plot, visualize, or create a chart from data that has already been retrieved. "
            "Note: This tool relies on the data from the last executed SQL query. If no query has been executed yet, you must use the nl2sql tool first."
        )

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The user's request describing how they want the data visualized (e.g., 'plot sales by month as a bar chart').",
                }
            },
            "required": ["query"],
        }

    async def execute(self, **kwargs: Any) -> str:
        query = kwargs.get("query", "")
        data = current_data.get()
        on_progress = current_progress_callback.get()

        if not data:
            return "Error: No data available to visualize. Please query the data first using the nl2sql tool."

        try:
            if on_progress:
                await on_progress("正在分析数据特征并生成可视化方案...")

            chart_response = await generate_chart(data, query)

            if chart_response.can_visualize:
                # Build the viz payload (similar to NL2SQL, but without the SQL part)
                # We reuse the previous viz_data if it exists (to keep SQL), or create a new one
                existing_viz = current_viz_data.get() or {}
                
                viz_payload = {
                    "sql": existing_viz.get("sql", ""),
                    "result": data,
                    "chart": chart_response.model_dump(by_alias=True, exclude_none=True),
                    "error": None,
                }
                encoded_viz = jsonable_encoder(viz_payload)
                if isinstance(existing_viz, dict):
                    existing_viz.clear()
                    existing_viz.update(encoded_viz)
                    current_viz_data.set(existing_viz)
                else:
                    current_viz_data.set(encoded_viz)
                
                return f"Successfully generated a {chart_response.chart_type} chart.\nReasoning: {chart_response.reasoning}"
            else:
                return f"Could not generate a chart: {chart_response.reasoning}"

        except Exception as e:
            logger.error(f"Visualization Tool error: {e}", exc_info=True)
            return f"An error occurred while generating the visualization: {str(e)}"
