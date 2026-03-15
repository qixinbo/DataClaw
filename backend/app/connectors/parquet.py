import duckdb
import pandas as pd
from typing import List, Dict, Any
import os

class ParquetConnector:
    def __init__(self, file_path: str):
        self.file_path = file_path
        if not os.path.exists(self.file_path):
             raise FileNotFoundError(f"Parquet file not found: {self.file_path}")

    def execute_query(self, query: str) -> List[Dict[str, Any]]:
        conn = duckdb.connect(":memory:")
        # Register the parquet file as a view or table
        # We can use read_parquet directly in query, or register it.
        # Let's register it as 'parquet_table' for simplicity in generated SQL, 
        # or we can ask LLM to use the filename.
        # A better approach for generic SQL is to register it as a table name derived from filename or just 'data'.
        table_name = os.path.splitext(os.path.basename(self.file_path))[0]
        conn.execute(f"CREATE OR REPLACE VIEW {table_name} AS SELECT * FROM read_parquet('{self.file_path}')")
        
        # If the query doesn't use the table name, we might have issues. 
        # But usually we provide schema with table name to LLM.
        try:
            # DuckDB returns a dataframe, we convert to dict
            df = conn.execute(query).df()
            return df.to_dict(orient="records")
        except Exception as e:
            print(f"Parquet Query Error: {e}")
            raise e
        finally:
            conn.close()

    def get_schema(self) -> Dict[str, List[str]]:
        conn = duckdb.connect(":memory:")
        table_name = os.path.splitext(os.path.basename(self.file_path))[0]
        conn.execute(f"CREATE OR REPLACE VIEW {table_name} AS SELECT * FROM read_parquet('{self.file_path}')")
        
        try:
            # Get columns
            columns = conn.execute(f"DESCRIBE {table_name}").fetchall()
            schema = {table_name: [f"{col[0]} ({col[1]})" for col in columns]}
            return schema
        except Exception as e:
            print(f"Error getting schema: {e}")
            return {}
        finally:
            conn.close()

    def test_connection(self) -> bool:
        try:
            conn = duckdb.connect(":memory:")
            conn.execute(f"SELECT * FROM read_parquet('{self.file_path}') LIMIT 1")
            conn.close()
            return True
        except Exception as e:
            print(f"Parquet Connection Error: {e}")
            return False
