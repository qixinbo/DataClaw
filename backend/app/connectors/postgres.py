from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from typing import Generator
import os

class PostgresConnector:
    def __init__(self, db_url: str = None):
        self.db_url = db_url or os.getenv("POSTGRES_URL", "postgresql://user:password@localhost:5432/dbname")
        self.engine = create_engine(self.db_url)
        self.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=self.engine)

    def get_db(self) -> Generator:
        db = self.SessionLocal()
        try:
            yield db
        finally:
            db.close()

    def execute_query(self, query: str):
        with self.engine.connect() as connection:
            result = connection.execute(text(query))
            return [dict(row._mapping) for row in result]

    def get_schema(self):
        query = """
        SELECT table_name, column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public'
        ORDER BY table_name, ordinal_position;
        """
        try:
            results = self.execute_query(query)
            schema = {}
            for row in results:
                table = row['table_name']
                if table not in schema:
                    schema[table] = []
                schema[table].append(f"{row['column_name']} ({row['data_type']})")
            return schema
        except Exception as e:
            print(f"Error getting schema: {e}")
            return {}

    def test_connection(self) -> bool:
        try:
            with self.engine.connect() as connection:
                connection.execute(text("SELECT 1"))
            return True
        except Exception as e:
            print(f"PostgreSQL Connection Error: {e}")
            return False

postgres_connector = PostgresConnector()
