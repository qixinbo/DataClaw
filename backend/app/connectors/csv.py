import duckdb
import pandas as pd
from typing import List, Dict, Any
import os
from app.core.files import resolve_upload_file_path

class CSVConnector:
    def __init__(self, file_path: str):
        self.file_path = file_path
        if not os.path.exists(self.file_path):
             raise FileNotFoundError(f"CSV file not found: {self.file_path}")

    def _get_table_name(self) -> str:
        # Normalize table name to be SQL safe-ish
        base = os.path.splitext(os.path.basename(self.file_path))[0]
        # Replace non-alphanumeric chars with underscore
        safe_name = "".join([c if c.isalnum() else "_" for c in base])
        # Ensure it doesn't start with a number
        if safe_name and safe_name[0].isdigit():
            safe_name = f"t_{safe_name}"
        return safe_name

    def execute_query(self, query: str) -> List[Dict[str, Any]]:
        conn = duckdb.connect(":memory:")
        table_name = self._get_table_name()
        
        # Register the csv file as a view
        # read_csv_auto is powerful
        try:
            conn.execute(f"CREATE OR REPLACE VIEW {table_name} AS SELECT * FROM read_csv_auto('{self.file_path}')")
            
            # Execute the user query
            # The query should rely on the table name provided in schema
            df = conn.execute(query).df()
            return df.to_dict(orient="records")
        except Exception as e:
            print(f"CSV Query Error: {e}")
            raise e
        finally:
            conn.close()

    def get_schema(self) -> Dict[str, List[Dict[str, str]]]:
        conn = duckdb.connect(":memory:")
        table_name = self._get_table_name()
        
        try:
            conn.execute(f"CREATE OR REPLACE VIEW {table_name} AS SELECT * FROM read_csv_auto('{self.file_path}')")
            
            # Get columns
            columns = conn.execute(f"DESCRIBE {table_name}").fetchall()
            # col[0] is name, col[1] is type
            schema = {table_name: [{"name": col[0], "type": col[1]} for col in columns]}
            return schema
        except Exception as e:
            print(f"Error getting schema: {e}")
            return {}
        finally:
            conn.close()

    def test_connection(self) -> bool:
        try:
            conn = duckdb.connect(":memory:")
            conn.execute(f"SELECT * FROM read_csv_auto('{self.file_path}') LIMIT 1")
            conn.close()
            return True
        except Exception as e:
            print(f"CSV Connection Error: {e}")
            return False
