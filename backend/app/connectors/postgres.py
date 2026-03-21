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
        try:
            from sqlalchemy import inspect
            inspector = inspect(self.engine)
            schema = {}
            # Default schema for postgres is 'public', sqlite is None
            schema_name = 'public' if self.engine.dialect.name == 'postgresql' else None
            
            table_names = inspector.get_table_names(schema=schema_name)
            
            # Use SQLAlchemy 2.0+ multi-fetch to avoid N+1 queries issue, especially over remote networks
            if hasattr(inspector, 'get_multi_columns'):
                multi_columns = inspector.get_multi_columns(schema=schema_name)
                multi_pk = inspector.get_multi_pk_constraint(schema=schema_name)
                multi_fk = inspector.get_multi_foreign_keys(schema=schema_name)
                
                for table_name in table_names:
                    key = (schema_name, table_name)
                    
                    columns = []
                    for col in multi_columns.get(key, []):
                        columns.append({
                            "name": col['name'], 
                            "type": str(col['type'])
                        })
                        
                    pk_constraint = multi_pk.get(key)
                    pks = pk_constraint.get('constrained_columns', []) if pk_constraint else []
                    
                    foreign_keys = []
                    for fk in multi_fk.get(key, []):
                        foreign_keys.append({
                            "constrained_columns": fk['constrained_columns'],
                            "referred_table": fk['referred_table'],
                            "referred_columns": fk['referred_columns']
                        })
                        
                    schema[table_name] = {
                        "columns": columns,
                        "primary_keys": pks,
                        "foreign_keys": foreign_keys
                    }
                return schema

            # Fallback for older SQLAlchemy versions
            for table_name in table_names:
                columns = []
                # get columns
                for col in inspector.get_columns(table_name, schema=schema_name):
                    columns.append({
                        "name": col['name'], 
                        "type": str(col['type'])
                    })
                
                # get primary key
                pk_constraint = inspector.get_pk_constraint(table_name, schema=schema_name)
                pks = pk_constraint.get('constrained_columns', []) if pk_constraint else []
                
                # get foreign keys
                fks = inspector.get_foreign_keys(table_name, schema=schema_name)
                foreign_keys = []
                for fk in fks:
                    foreign_keys.append({
                        "constrained_columns": fk['constrained_columns'],
                        "referred_table": fk['referred_table'],
                        "referred_columns": fk['referred_columns']
                    })
                
                schema[table_name] = {
                    "columns": columns,
                    "primary_keys": pks,
                    "foreign_keys": foreign_keys
                }
            return schema
        except Exception as e:
            import traceback
            traceback.print_exc()
            print(f"Error getting schema: {e}")
            raise e

    def test_connection(self) -> bool:
        try:
            with self.engine.connect() as connection:
                connection.execute(text("SELECT 1"))
            return True
        except Exception as e:
            print(f"PostgreSQL Connection Error: {e}")
            raise e

postgres_connector = PostgresConnector()
