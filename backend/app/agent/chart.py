import json
from typing import List, Dict, Any, Optional
import sys
from pathlib import Path

# Add project root to sys.path
PROJECT_ROOT = Path(__file__).resolve().parents[3]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.append(str(PROJECT_ROOT))

from nanobot.providers.litellm_provider import LiteLLMProvider
from app.schemas.chart import ChartGenerationResponse
from app.services.llm_cache import get_active_llm_config

CHART_MAX_TOKENS = 700
CHART_TEMPERATURE = 0.2
CHART_REASONING_EFFORT = "low"

CHART_INSTRUCTIONS = """
### INSTRUCTIONS ###

- Chart types: Bar chart, Line chart, Multi line chart, Area chart, Pie chart, Stacked bar chart, Grouped bar chart
- You can only use the chart types provided in the instructions
- Generated chart should answer the user's question and based on the semantics of the SQL query, and the sample data, sample column values are used to help you generate the suitable chart type
- If the sample data is not suitable for visualization, you must return an empty string for the schema and chart type
- If the sample data is empty, you must return an empty string for the schema and chart type
- The language for the chart and reasoning must be the same language provided by the user
- Please use the current time provided by the user to generate the chart
- In order to generate the grouped bar chart, you need to follow the given instructions:
    - Disable Stacking: Add "stack": null to the y-encoding.
    - Use xOffset for subcategories to group bars.
    - Don't use "transform" section.
- In order to generate the pie chart, you need to follow the given instructions:
    - Add {"type": "arc"} to the mark section.
    - Add "theta" encoding to the encoding section.
    - Add "color" encoding to the encoding section.
    - Don't add "innerRadius" to the mark section.
- If the x-axis of the chart is a temporal field, the time unit should be the same as the question user asked.
    - For yearly question, the time unit should be "year".
    - For monthly question, the time unit should be "yearmonth".
    - For weekly question, the time unit should be "yearmonthdate".
    - For daily question, the time unit should be "yearmonthdate".
    - Default time unit is "yearmonth".
- For each axis, generate the corresponding human-readable title based on the language provided by the user.
- Make sure all of the fields(x, y, xOffset, color, etc.) in the encoding section of the chart schema are present in the column names of the data.

### GUIDELINES TO PLOT CHART ###

1. Understanding Your Data Types
- Nominal (Categorical): Names or labels without a specific order (e.g., types of fruits, countries).
- Ordinal: Categorical data with a meaningful order but no fixed intervals (e.g., rankings, satisfaction levels).
- Quantitative: Numerical values representing counts or measurements (e.g., sales figures, temperatures).
- Temporal: Date or time data (e.g., timestamps, dates).
2. Chart Types and When to Use Them
- Bar Chart
    - Use When: Comparing quantities across different categories.
    - Data Requirements:
        - One categorical variable (x-axis).
        - One quantitative variable (y-axis).
    - Example: Comparing sales numbers for different product categories.
- Grouped Bar Chart
    - Use When: Comparing sub-categories within main categories.
    - Data Requirements:
        - Two categorical variables (x-axis grouped by one, color-coded by another).
        - One quantitative variable (y-axis).
        - Example: Sales numbers for different products across various regions.
- Line Chart
    - Use When: Displaying trends over continuous data, especially time.
    - Data Requirements:
        - One temporal or ordinal variable (x-axis).
        - One quantitative variable (y-axis).
    - Example: Tracking monthly revenue over a year.
- Multi Line Chart
    - Use When: Displaying trends over continuous data, especially time.
    - Data Requirements:
        - One temporal or ordinal variable (x-axis).
        - Two or more quantitative variables (y-axis and color).
    - Implementation Notes:
        - Uses `transform` with `fold` to combine multiple metrics into a single series
        - The folded metrics are distinguished using the color encoding
    - Example: Tracking monthly click rate and read rate over a year.
- Area Chart
    - Use When: Similar to line charts but emphasizing the volume of change over time.
    - Data Requirements:
        - Same as Line Chart.
    - Example: Visualizing cumulative rainfall over months.
- Pie Chart
    - Use When: Showing parts of a whole as percentages.
    - Data Requirements:
        - One categorical variable.
        - One quantitative variable representing proportions.
    - Example: Market share distribution among companies.
- Stacked Bar Chart
    - Use When: Showing composition and comparison across categories.
    - Data Requirements: Same as grouped bar chart.
    - Example: Sales by region and product type.
"""

CHART_EXAMPLES = """
### EXAMPLES ###

1. Bar Chart
- Sample Data:
 [
    {"Region": "North", "Sales": 100},
    {"Region": "South", "Sales": 200},
    {"Region": "East", "Sales": 300},
    {"Region": "West", "Sales": 400}
]
- Chart Schema:
{
    "title": <TITLE_IN_LANGUAGE_PROVIDED_BY_USER>,
    "mark": {"type": "bar"},
    "encoding": {
        "x": {"field": "Region", "type": "nominal", "title": <TITLE_IN_LANGUAGE_PROVIDED_BY_USER>},
        "y": {"field": "Sales", "type": "quantitative", "title": <TITLE_IN_LANGUAGE_PROVIDED_BY_USER>},
        "color": {"field": "Region", "type": "nominal", "title": "<TITLE_IN_LANGUAGE_PROVIDED_BY_USER>"}
    }
}
2. Line Chart
- Sample Data:
[
    {"Date": "2022-01-01", "Sales": 100},
    {"Date": "2022-01-02", "Sales": 200},
    {"Date": "2022-01-03", "Sales": 300},
    {"Date": "2022-01-04", "Sales": 400}
]
- Chart Schema:
{
    "title": <TITLE_IN_LANGUAGE_PROVIDED_BY_USER>,
    "mark": {"type": "line"},
    "encoding": {
        "x": {"field": "Date", "type": "temporal", "title": <TITLE_IN_LANGUAGE_PROVIDED_BY_USER>},
        "y": {"field": "Sales", "type": "quantitative", "title": <TITLE_IN_LANGUAGE_PROVIDED_BY_USER>}
    }
}
"""

async def generate_chart(data: List[Dict[str, Any]], query: str) -> ChartGenerationResponse:
    active_config = get_active_llm_config()
    
    if not active_config:
        return ChartGenerationResponse(
            reasoning="No active LLM configuration found",
            can_visualize=False,
            chart_type=""
        )
    
    try:
        provider = LiteLLMProvider(
            api_key=active_config.get("api_key"),
            api_base=active_config.get("api_base"),
            default_model=active_config.get("model"),
            extra_headers=active_config.get("extra_headers") or {},
            provider_name=active_config.get("provider")
        )
    except Exception as e:
        return ChartGenerationResponse(
            reasoning=f"Failed to initialize LLM provider: {e}",
            can_visualize=False,
            chart_type=""
        )

    # 2. Prepare Data Sample
    if not data:
        return ChartGenerationResponse(
            reasoning="No data provided to visualize",
            can_visualize=False,
            chart_type=""
        )

    sample_size = 5
    sample_data = data[:sample_size]
    # Handle case where data might not be list of dicts
    if isinstance(data[0], (list, tuple)):
        # If it's a list of lists, we can't easily infer columns without more info.
        # For now, assume it's list of dicts as per postgres/clickhouse connector expectation (formatted_results)
        columns = [f"col_{i}" for i in range(len(data[0]))]
    else:
        columns = list(data[0].keys())
    
    # 3. Construct Prompt
    schema_json = json.dumps(ChartGenerationResponse.model_json_schema(), ensure_ascii=False, separators=(",", ":"))
    
    system_prompt = f"""You are a data analyst great at visualizing data using vega-lite! Given the user's question, sample data and sample column values, you need to generate vega-lite schema in JSON and provide suitable chart type.
Besides, you need to give a concise and easy-to-understand reasoning to describe why you provide such vega-lite schema based on the question, sample data and sample column values.

{CHART_INSTRUCTIONS}

{CHART_EXAMPLES}

- If the user provides a custom instruction, it should be followed strictly and you should use it to change the style of response for reasoning.

### OUTPUT FORMAT ###

You must return a valid JSON object strictly matching the following JSON Schema:

{schema_json}

Please provide your chain of thought reasoning, chart type and the vega-lite schema in JSON format.
"""
    
    user_prompt = f"""
### INPUT ###
Question: {query}
Sample Data: {json.dumps(sample_data, ensure_ascii=False, separators=(",", ":"), default=str)}
Sample Column Values: {columns}
Language: Chinese (Simplified)
"""

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt}
    ]

    # 4. Call LLM
    try:
        response = await provider.chat(
            messages=messages,
            max_tokens=CHART_MAX_TOKENS,
            temperature=CHART_TEMPERATURE,
            reasoning_effort=CHART_REASONING_EFFORT,
        )
        content = response.content
        
        # Clean up code blocks
        if "```json" in content:
            content = content.split("```json")[1].split("```")[0]
        elif "```" in content:
            content = content.split("```")[1].split("```")[0]
            
        content = content.strip()
        result = json.loads(content)
        return ChartGenerationResponse(**result)
        
    except Exception as e:
        return ChartGenerationResponse(
            reasoning=f"Failed to generate chart configuration: {str(e)}",
            can_visualize=False,
            chart_type=""
        )
