import base64
import json
from typing import Any

import httpx

from backend.app.config import Settings
from backend.app.models import DraftField, FieldSource, ProductImageAnalysis
from backend.app.services.field_policy import MANUAL_REQUIREMENTS


class AIProviderError(RuntimeError):
    pass


class AIClient:
    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None):
        if not settings.openai_api_key:
            raise AIProviderError("OPENAI_API_KEY is not configured")
        self.settings = settings
        self.client = httpx.AsyncClient(
            base_url=settings.openai_base_url.rstrip("/"),
            headers={"Authorization": f"Bearer {settings.openai_api_key}"},
            timeout=60,
            transport=transport,
        )

    async def close(self) -> None:
        await self.client.aclose()

    async def analyze_product_image(
        self,
        image_bytes: bytes,
        content_type: str,
        known_facts: dict[str, Any],
        category_hint: str | None,
    ) -> ProductImageAnalysis:
        encoded = base64.b64encode(image_bytes).decode()
        facts = json.dumps(known_facts, ensure_ascii=False)
        prompt = (
            "Analyze one product image for an Alibaba.com listing. Return JSON only. "
            "Never infer price, material, dimensions, weight, certification, origin, stock, "
            "lead time, MOQ, SKU, production capacity, or logistics. If text or a visual fact "
            "is unclear, omit it. Generated copy must only use visible or supplied facts. "
            "Use this shape: {"
            '"observed_fields":{"color":{"value":"...","confidence":0.0,"evidence":"..."}},'
            '"generated_fields":{"title":{"value":"..."},"keywords":{"value":["..."]},'
            '"selling_points":{"value":["..."]},"description":{"value":"..."}},'
            '"category_suggestions":[{"value":"...","confidence":0.0,"evidence":"..."}],'
            '"warnings":["..."]}. '
            f"Known facts: {facts}. Category hint: {category_hint or 'none'}."
        )
        payload = {
            "model": self.settings.text_model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:{content_type};base64,{encoded}"},
                        },
                    ],
                }
            ],
            "temperature": 0.2,
        }
        response = await self.client.post("/chat/completions", json=payload)
        if response.is_error:
            raise AIProviderError(f"AI provider returned HTTP {response.status_code}")
        try:
            content = response.json()["choices"][0]["message"]["content"]
            data = self._parse_json(content)
        except (KeyError, IndexError, TypeError, ValueError, json.JSONDecodeError) as exc:
            raise AIProviderError("AI provider returned an invalid structured response") from exc

        observed = {
            name: DraftField(
                value=item.get("value"),
                source=FieldSource.IMAGE_EXTRACTED,
                confidence=item.get("confidence"),
                requires_confirmation=True,
                evidence=item.get("evidence"),
            )
            for name, item in data.get("observed_fields", {}).items()
            if isinstance(item, dict) and item.get("value") not in (None, "")
        }
        generated = {
            name: DraftField(
                value=item.get("value"),
                source=FieldSource.AI_GENERATED,
                requires_confirmation=True,
            )
            for name, item in data.get("generated_fields", {}).items()
            if isinstance(item, dict) and item.get("value") not in (None, "")
        }
        suggestions = [
            DraftField(
                value=item.get("value"),
                source=FieldSource.AI_GENERATED,
                confidence=item.get("confidence"),
                requires_confirmation=True,
                evidence=item.get("evidence"),
            )
            for item in data.get("category_suggestions", [])
            if isinstance(item, dict) and item.get("value") not in (None, "")
        ]
        return ProductImageAnalysis(
            observed_fields=observed,
            generated_fields=generated,
            category_suggestions=suggestions,
            manual_requirements=MANUAL_REQUIREMENTS,
            warnings=list(data.get("warnings", [])),
        )

    async def generate_image(self, prompt: str, size: str, count: int) -> dict[str, Any]:
        response = await self.client.post(
            "/images/generations",
            json={
                "model": self.settings.image_model,
                "prompt": prompt,
                "size": size,
                "n": count,
            },
        )
        if response.is_error:
            raise AIProviderError(f"Image provider returned HTTP {response.status_code}")
        data = response.json()
        if not isinstance(data, dict) or "data" not in data:
            raise AIProviderError("Image provider returned an invalid response")
        return data

    @staticmethod
    def _parse_json(content: str) -> dict[str, Any]:
        value = content.strip()
        if value.startswith("```"):
            value = value.split("\n", 1)[1].rsplit("```", 1)[0]
        parsed = json.loads(value)
        if not isinstance(parsed, dict):
            raise ValueError("Expected a JSON object")
        return parsed
