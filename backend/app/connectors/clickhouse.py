from clickhouse_driver import Client
import os

class ClickHouseConnector:
    def __init__(self, host: str = None, port: int = 9000, user: str = 'default', password: str = '', database: str = 'default'):
        self.host = host or os.getenv("CLICKHOUSE_HOST", "localhost")
        self.port = port or int(os.getenv("CLICKHOUSE_PORT", 9000))
        self.user = user or os.getenv("CLICKHOUSE_USER", "default")
        self.password = password or os.getenv("CLICKHOUSE_PASSWORD", "")
        self.database = database or os.getenv("CLICKHOUSE_DB", "default")
        
        self.client = Client(
            host=self.host, 
            port=self.port, 
            user=self.user, 
            password=self.password, 
            database=self.database
        )

    def execute_query(self, query: str):
        try:
            return self.client.execute(query, with_column_types=True)
        except Exception as e:
            print(f"ClickHouse Query Error: {e}")
            raise e

    def get_schema(self):
        query = "SELECT table, name, type FROM system.columns WHERE database = currentDatabase()"
        try:
            results = self.client.execute(query)
            schema = {}
            for row in results:
                table = row[0]
                if table not in schema:
                    schema[table] = []
                schema[table].append({"name": row[1], "type": row[2]})
            return schema
        except Exception as e:
            print(f"Error getting schema: {e}")
            return {}

    def test_connection(self) -> bool:
        try:
            self.client.execute("SELECT 1")
            return True
        except Exception as e:
            print(f"ClickHouse Connection Error: {e}")
            return False

clickhouse_connector = ClickHouseConnector()
