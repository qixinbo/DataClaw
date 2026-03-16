from typing import List, Optional, Dict, Any, Union, Literal
from pydantic import BaseModel, Field

# Common Types
AccessControlOperator = Literal[
    "EQUALS", "NOT_EQUALS", "GREATER_THAN", "LESS_THAN", 
    "GREATER_THAN_OR_EQUALS", "LESS_THAN_OR_EQUALS"
]

JoinType = Literal["ONE_TO_ONE", "ONE_TO_MANY", "MANY_TO_ONE", "MANY_TO_MANY"]

# Column Definitions
class SessionProperty(BaseModel):
    name: str
    required: bool
    defaultExpr: Optional[str] = None

class AccessControlThreshold(BaseModel):
    value: str
    dataType: Literal["NUMERIC", "STRING"]

class ColumnAccessControl(BaseModel):
    name: str
    operator: AccessControlOperator
    requiredProperties: List[SessionProperty]
    threshold: Optional[AccessControlThreshold] = None

class Column(BaseModel):
    name: str
    type: str
    relationship: Optional[str] = None
    isCalculated: bool = False
    notNull: bool = False
    expression: Optional[str] = None
    isHidden: bool = False
    columnLevelAccessControl: Optional[ColumnAccessControl] = None
    properties: Dict[str, str] = Field(default_factory=dict)

# Model Definitions
class TableReference(BaseModel):
    catalog: Optional[str] = None
    schema_: Optional[str] = Field(None, alias="schema")
    table: str

class RowLevelAccessControl(BaseModel):
    name: str
    requiredProperties: List[SessionProperty]
    condition: str

class Model(BaseModel):
    name: str
    tableReference: Optional[TableReference] = None
    refSql: Optional[str] = None
    baseObject: Optional[str] = None
    columns: List[Column] = Field(default_factory=list)
    primaryKey: Optional[str] = None
    cached: bool = False
    refreshTime: Optional[str] = None
    rowLevelAccessControls: List[RowLevelAccessControl] = Field(default_factory=list)
    properties: Dict[str, Any] = Field(default_factory=dict)

# Relationship Definitions
class Relationship(BaseModel):
    name: str
    models: List[str] # minItems: 2, maxItems: 2
    joinType: JoinType
    condition: str
    properties: Dict[str, Any] = Field(default_factory=dict)

# Metric Definitions
class MetricTimeGrain(BaseModel):
    name: str
    refColumn: str
    dateParts: List[str]

class Metric(BaseModel):
    name: str
    baseObject: str
    dimension: List[Column] = Field(default_factory=list)
    measure: List[Column] = Field(default_factory=list)
    timeGrain: List[MetricTimeGrain] = Field(default_factory=list)
    cached: bool = False
    refreshTime: Optional[str] = None
    properties: Dict[str, Any] = Field(default_factory=dict)

# View Definitions
class View(BaseModel):
    name: str
    statement: str
    properties: Dict[str, Any] = Field(default_factory=dict)

# Enum Definitions
class EnumValue(BaseModel):
    name: str
    value: Optional[str] = None
    properties: Dict[str, Any] = Field(default_factory=dict)

class EnumDefinition(BaseModel):
    name: str
    values: List[EnumValue]
    properties: Dict[str, Any] = Field(default_factory=dict)

# Main Manifest
class MDLManifest(BaseModel):
    catalog: str
    schema_: str = Field(..., alias="schema") # 'schema' is a reserved word in Pydantic v1/Python, aliasing
    dataSource: Optional[str] = None
    models: List[Model] = Field(default_factory=list)
    relationships: List[Relationship] = Field(default_factory=list)
    metrics: List[Metric] = Field(default_factory=list)
    views: List[View] = Field(default_factory=list)
    enumDefinitions: List[EnumDefinition] = Field(default_factory=list)
    
    class Config:
        populate_by_name = True
