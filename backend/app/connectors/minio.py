from minio import Minio
from minio.error import S3Error
import os
from typing import BinaryIO

class MinioConnector:
    def __init__(self):
        self.endpoint = os.getenv("MINIO_ENDPOINT", "localhost:9000")
        self.access_key = os.getenv("MINIO_ACCESS_KEY", "minioadmin")
        self.secret_key = os.getenv("MINIO_SECRET_KEY", "minioadmin")
        self.secure = os.getenv("MINIO_SECURE", "False").lower() == "true"
        self.bucket_name = os.getenv("MINIO_BUCKET", "dataclaw")

        self.client = Minio(
            self.endpoint,
            access_key=self.access_key,
            secret_key=self.secret_key,
            secure=self.secure
        )
        self._ensure_bucket_exists()

    def _ensure_bucket_exists(self):
        try:
            if not self.client.bucket_exists(self.bucket_name):
                self.client.make_bucket(self.bucket_name)
        except S3Error as e:
            print(f"MinIO Bucket Error: {e}")

    def upload_file(self, object_name: str, file_data: BinaryIO, length: int, content_type: str = "application/octet-stream"):
        try:
            self.client.put_object(
                self.bucket_name,
                object_name,
                file_data,
                length,
                content_type=content_type
            )
            return f"http{'s' if self.secure else ''}://{self.endpoint}/{self.bucket_name}/{object_name}"
        except S3Error as e:
            print(f"MinIO Upload Error: {e}")
            raise e

    def test_connection(self) -> bool:
        try:
            self.client.list_buckets()
            return True
        except Exception as e:
            print(f"MinIO Connection Error: {e}")
            return False

minio_connector = MinioConnector()
