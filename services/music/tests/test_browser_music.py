import sys
from pathlib import Path
import tempfile
import unittest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from nas_api import create_nas_app


class BrowserMusicTests(unittest.TestCase):
    def test_exact_origin_preflight_auth_and_internal_isolation(self):
        origin = "https://drivemode.grok.me"
        token, bridge = "c" * 64, "b" * 64
        with tempfile.TemporaryDirectory() as tmp:
            with TestClient(create_nas_app(Path(tmp), token, bridge, min_free_bytes=0,
                                           allowed_origins=[origin])) as client:
                headers = {"Origin": origin, "Access-Control-Request-Method": "POST",
                           "Access-Control-Request-Headers": "authorization,content-type"}
                response = client.options("/v1/jobs", headers=headers)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers["Access-Control-Allow-Origin"], origin)
                self.assertNotIn("Access-Control-Allow-Credentials", response.headers)
                self.assertEqual(client.get("/health", headers={"Origin": origin}).status_code, 401)
                response = client.get("/health", headers={"Origin": origin, "Authorization": "Bearer " + token})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers["Access-Control-Allow-Origin"], origin)
                for evil in ["https://evil.test", origin + ".evil.test", "null"]:
                    self.assertEqual(client.options("/v1/jobs", headers={**headers, "Origin": evil}).status_code, 403)
                self.assertEqual(client.options("/internal/worker/poll", headers=headers).status_code, 403)
                self.assertEqual(client.post("/internal/worker/poll", headers={"Origin": origin, "Authorization": "Bearer " + bridge}, json={"ready": True, "sessionId": "x"}).status_code, 403)
                self.assertEqual(client.options("/v1/jobs", headers={**headers, "Access-Control-Request-Headers": "x-unapproved"}).status_code, 403)
