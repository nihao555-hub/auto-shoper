import base64
import json
from typing import Any

import httpx
from pydantic import BaseModel, Field, ValidationError

from backend.app.config import Settings
from backend.app.models import DraftField, FieldSource, ProductImageAnalysis
from backend.app.services.field_policy import MANUAL_REQUIREMENTS, is_manual_fact_field


class AIProviderError(RuntimeError):
    pass


class _ProviderField(BaseModel):
    value: str | list[str]
    confidence: float | None = Field(default=None, ge=0, le=1)
    evidence: str | None = None


class _ProviderAnalysis(BaseModel):
    observed_fields: dict[str, _ProviderField] = Field(default_factory=dict)
    generated_fields: dict[str, _ProviderField] = Field(default_factory=dict)
    category_suggestions: list[_ProviderField] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


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
            '"warnings":["..."]}. Return no more than three keywords. '
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
            raise AIProviderError(self._provider_error(response))
        try:
            content = response.json()["choices"][0]["message"]["content"]
            data = _ProviderAnalysis.model_validate(self._parse_json(content))
        except (
            KeyError,
            IndexError,
            TypeError,
            ValueError,
            ValidationError,
            json.JSONDecodeError,
        ) as exc:
            raise AIProviderError("AI provider returned an invalid structured response") from exc

        excluded_fields = sorted(
            name
            for name in {*data.observed_fields, *data.generated_fields}
            if is_manual_fact_field(name)
        )
        observed = {
            name: DraftField(
                value=item.value,
                source=FieldSource.IMAGE_EXTRACTED,
                confidence=item.confidence,
                requires_confirmation=True,
                evidence=item.evidence,
            )
            for name, item in data.observed_fields.items()
            if name not in excluded_fields and item.value not in (None, "")
        }
        generated = {
            name: DraftField(
                value=item.value,
                source=FieldSource.AI_GENERATED,
                requires_confirmation=True,
            )
            for name, item in data.generated_fields.items()
            if name not in excluded_fields and item.value not in (None, "")
        }
        suggestions = [
            DraftField(
                value=item.value,
                source=FieldSource.AI_GENERATED,
                confidence=item.confidence,
                requires_confirmation=True,
                evidence=item.evidence,
            )
            for item in data.category_suggestions
            if item.value not in (None, "")
        ]
        warnings = list(data.warnings)
        keywords = generated.get("keywords")
        if keywords and isinstance(keywords.value, list) and len(keywords.value) > 3:
            keywords.value = keywords.value[:3]
            warnings.append("AI keywords were limited to the Alibaba maximum of three")
        if excluded_fields:
            warnings.append(
                f"AI-sourced business facts were removed: {', '.join(excluded_fields)}"
            )
        return ProductImageAnalysis(
            observed_fields=observed,
            generated_fields=generated,
            category_suggestions=suggestions,
            manual_requirements=MANUAL_REQUIREMENTS,
            warnings=warnings,
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
            raise AIProviderError(self._provider_error(response))
        data = response.json()
        if not isinstance(data, dict) or "data" not in data:
            raise AIProviderError("Image provider returned an invalid response")
        return data

    async def edit_product_image(
        self,
        image_bytes: bytes,
        file_name: str,
        content_type: str,
        prompt: str,
        size: str,
        count: int,
    ) -> dict[str, Any]:
        preservation_prompt = (
            "Preserve the exact product identity, shape, proportions, count, color, labels, "
            "logo, components, and visible construction from the reference image. Do not add "
            "or remove product parts, accessories, claims, certification marks, or text. "
            f"Only change the presentation as requested: {prompt}"
        )
        response = await self.client.post(
            "/images/edits",
            data={
                "model": self.settings.image_model,
                "prompt": preservation_prompt,
                "size": size,
                "n": str(count),
            },
            files={"image": (file_name, image_bytes, content_type)},
        )
        if response.is_error:
            raise AIProviderError(self._provider_error(response))
        data = response.json()
        if not isinstance(data, dict) or not isinstance(data.get("data"), list):
            raise AIProviderError("Image provider returned an invalid response")
        return {
            **data,
            "requires_confirmation": True,
            "source_image_preservation_required": True,
        }

    @staticmethod
    def _parse_json(content: str) -> dict[str, Any]:
        value = content.strip()
        if value.startswith("```"):
            value = value.split("\n", 1)[1].rsplit("```", 1)[0]
        parsed = json.loads(value)
        if not isinstance(parsed, dict):
            raise ValueError("Expected a JSON object")
        return parsed

    @staticmethod
    def _provider_error(response: httpx.Response) -> str:
        message: str | None = None
        try:
            data = response.json()
        except ValueError:
            data = None
        if isinstance(data, dict):
            error = data.get("error")
            if isinstance(error, dict) and error.get("message"):
                message = str(error["message"])
            elif isinstance(error, str):
                message = error
            elif data.get("message"):
                message = str(data["message"])
        suffix = f": {message}" if message else ""
        return f"AI provider returned HTTP {response.status_code}{suffix}"
