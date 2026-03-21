import asyncio
import json
from app.agent.nl2sql import process_nl2sql, NL2SQLRequest

async def main():
    req = NL2SQLRequest(query="列出所有表", source="postgres", generate_chart=False)
    res = await process_nl2sql(req)
    print("SQL:", res.sql)
    print("Error:", res.error)
    print("Result:", res.result)

asyncio.run(main())
