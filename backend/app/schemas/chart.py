from typing import Any, Dict, List, Optional, Literal, Union
from pydantic import BaseModel, Field

# Base Chart Schema
class ChartSchema(BaseModel):
    class ChartType(BaseModel):
        type: Literal["bar", "line", "area", "arc"]

    class ChartEncoding(BaseModel):
        field: str
        type: Literal["ordinal", "quantitative", "nominal"]
        title: str

    title: str
    mark: ChartType
    encoding: ChartEncoding

class TemporalChartEncoding(ChartSchema.ChartEncoding):
    type: Literal["temporal"] = Field(default="temporal")
    timeUnit: str = Field(default="yearmonth")

# Line Chart
class LineChartSchema(ChartSchema):
    class LineChartMark(BaseModel):
        type: Literal["line"] = Field(default="line")

    class LineChartEncoding(BaseModel):
        x: Union[TemporalChartEncoding, ChartSchema.ChartEncoding]
        y: ChartSchema.ChartEncoding
        color: Optional[ChartSchema.ChartEncoding] = None

    mark: LineChartMark
    encoding: LineChartEncoding

# Multi Line Chart
class MultiLineChartSchema(ChartSchema):
    class MultiLineChartMark(BaseModel):
        type: Literal["line"] = Field(default="line")

    class MultiLineChartTransform(BaseModel):
        fold: List[str]
        as_: List[str] = Field(alias="as")

    class MultiLineChartEncoding(BaseModel):
        x: Union[TemporalChartEncoding, ChartSchema.ChartEncoding]
        y: ChartSchema.ChartEncoding
        color: ChartSchema.ChartEncoding

    mark: MultiLineChartMark
    transform: List[MultiLineChartTransform]
    encoding: MultiLineChartEncoding

# Bar Chart
class BarChartSchema(ChartSchema):
    class BarChartMark(BaseModel):
        type: Literal["bar"] = Field(default="bar")

    class BarChartEncoding(BaseModel):
        x: Union[TemporalChartEncoding, ChartSchema.ChartEncoding]
        y: ChartSchema.ChartEncoding
        color: Optional[ChartSchema.ChartEncoding] = None

    mark: BarChartMark
    encoding: BarChartEncoding

# Grouped Bar Chart
class GroupedBarChartSchema(ChartSchema):
    class GroupedBarChartMark(BaseModel):
        type: Literal["bar"] = Field(default="bar")

    class GroupedBarChartEncoding(BaseModel):
        x: Union[TemporalChartEncoding, ChartSchema.ChartEncoding]
        y: ChartSchema.ChartEncoding
        xOffset: ChartSchema.ChartEncoding
        color: ChartSchema.ChartEncoding

    mark: GroupedBarChartMark
    encoding: GroupedBarChartEncoding

# Stacked Bar Chart
class StackedBarChartYEncoding(ChartSchema.ChartEncoding):
    stack: Literal["zero"] = Field(default="zero")

class StackedBarChartSchema(ChartSchema):
    class StackedBarChartMark(BaseModel):
        type: Literal["bar"] = Field(default="bar")

    class StackedBarChartEncoding(BaseModel):
        x: Union[TemporalChartEncoding, ChartSchema.ChartEncoding]
        y: StackedBarChartYEncoding
        color: ChartSchema.ChartEncoding

    mark: StackedBarChartMark
    encoding: StackedBarChartEncoding

# Pie Chart
class PieChartSchema(ChartSchema):
    class PieChartMark(BaseModel):
        type: Literal["arc"] = Field(default="arc")

    class PieChartEncoding(BaseModel):
        theta: ChartSchema.ChartEncoding
        color: ChartSchema.ChartEncoding

    mark: PieChartMark
    encoding: PieChartEncoding

# Area Chart
class AreaChartSchema(ChartSchema):
    class AreaChartMark(BaseModel):
        type: Literal["area"] = Field(default="area")

    class AreaChartEncoding(BaseModel):
        x: Union[TemporalChartEncoding, ChartSchema.ChartEncoding]
        y: ChartSchema.ChartEncoding

    mark: AreaChartMark
    encoding: AreaChartEncoding

# Response Model
class ChartGenerationResponse(BaseModel):
    reasoning: str = Field(..., description="Reasoning for the chart choice or why a chart cannot be generated")
    chart_type: Literal[
        "line", "multi_line", "bar", "pie", "grouped_bar", "stacked_bar", "area", ""
    ] = Field(..., description="The type of chart generated, or empty string if none")
    chart_spec: Optional[Union[
        LineChartSchema,
        MultiLineChartSchema,
        BarChartSchema,
        PieChartSchema,
        GroupedBarChartSchema,
        StackedBarChartSchema,
        AreaChartSchema
    ]] = Field(None, description="The generated Vega-Lite chart specification")
    can_visualize: bool = Field(..., description="Whether the data can be visualized")
