import json
import logging
from typing import Any, Dict

from nanobot.agent.tools.base import Tool
from app.agent.nl2sql import process_nl2sql, NL2SQLRequest, NL2SQLResponse
from app.context import current_progress_callback, current_viz_data, current_data_source, current_file_url, current_data
from fastapi.encoders import jsonable_encoder

logger = logging.getLogger(__name__)

def _build_sql_chart_viz(nl2sql_result: NL2SQLResponse) -> dict:
    chart = nl2sql_result.chart
    payload = {
        "sql": nl2sql_result.sql,
        "result": nl2sql_result.result,
        "chart": chart.model_dump() if chart else None,
        "error": nl2sql_result.error,
    }
    return jsonable_encoder(payload)

class NL2SQLTool(Tool):
    """
    Tool for translating natural language queries into SQL, executing them,
    and optionally generating visualizations.
    """

    @property
    def name(self) -> str:
        return "nl2sql"

    @property
    def description(self) -> str:
        return (
            "Query the connected database or data source using natural language. "
            "Use this tool when the user asks to query, analyze, aggregate, or fetch data from the database. "
            "Set generate_chart=True if the user also wants to visualize or plot the data."
        )

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The natural language query describing what data to fetch or analyze.",
                },
                "generate_chart": {
                    "type": "boolean",
                    "description": "Whether to automatically generate a visualization chart for the result. Default is False.",
                }
            },
            "required": ["query"],
        }

    async def execute(self, **kwargs: Any) -> str:
        query = kwargs.get("query", "")
        generate_chart = kwargs.get("generate_chart", False)
        
        # Get context
        source = current_data_source.get()
        file_url = current_file_url.get()
        on_progress = current_progress_callback.get()

        request = NL2SQLRequest(
            query=query,
            source=source,
            file_url=file_url,
            generate_chart=generate_chart,
        )

        try:
            # Call the core logic
            result = await process_nl2sql(request, on_progress=on_progress)
            
            if result.error:
                return f"Error executing query: {result.error}"

            # Save the result data to context for potential later use by VisualizationTool
            if result.result:
                current_data.set(result.result)

            # Save visualization payload to context so the chat stream can pick it up
            viz_payload = _build_sql_chart_viz(result)
            existing_viz = current_viz_data.get()
            if isinstance(existing_viz, dict):
                existing_viz.clear()
                existing_viz.update(viz_payload)
                current_viz_data.set(existing_viz)
            else:
                current_viz_data.set(viz_payload)

            # Build a summary string for the Agent to read
            row_count = len(result.result) if result.result else 0
            
            summary_parts = [f"Successfully executed SQL query."]
            summary_parts.append(f"SQL: {result.sql}")
            summary_parts.append(f"Rows returned: {row_count}")
            
            if generate_chart:
                if result.chart and result.chart.can_visualize:
                    summary_parts.append("Chart was successfully generated.")
                    if result.chart.reasoning:
                        summary_parts.append(f"Chart Reasoning: {result.chart.reasoning}")
                else:
                    summary_parts.append("Requested a chart, but the data was not suitable for visualization.")

            summary_parts.append("\nSample data (first 5 rows):")
            sample = result.result[:5] if result.result else []
            summary_parts.append(json.dumps(jsonable_encoder(sample), ensure_ascii=False))
            
            return "\n".join(summary_parts)
            
        except Exception as e:
            logger.error(f"NL2SQL Tool error: {e}", exc_info=True)
            return f"An unexpected error occurred during NL2SQL execution: {str(e)}"
