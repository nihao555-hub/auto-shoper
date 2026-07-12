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
    display_value_zh: str | list[str] | None = None
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
        field_guidance: str | None = None,
    ) -> ProductImageAnalysis:
        return await self.analyze_product_images(
            [(image_bytes, content_type)],
            known_facts,
            category_hint,
            field_guidance,
        )

    async def analyze_product_images(
        self,
        images: list[tuple[bytes, str]],
        known_facts: dict[str, Any],
        category_hint: str | None,
        field_guidance: str | None = None,
    ) -> ProductImageAnalysis:
        facts = json.dumps(known_facts, ensure_ascii=False)
        prompt = (
            "Analyze this image set as one product for an Alibaba.com listing. The first image is "
            "the selected main image; the remaining images may show details, specifications, "
            "performance, packaging, or supplier information. Return one consolidated JSON "
            "result only. "
            "Never infer price, material, dimensions, weight, certification, origin, stock, "
            "lead time, MOQ, SKU, production capacity, or logistics. If text or a visual fact "
            "is unclear, omit it. Generated copy must only use visible or supplied facts. "
            "Keep publication-ready generated values and category suggestions in English. For "
            "every observed field, generated field, and category suggestion, also return a clear "
            "Simplified Chinese seller-facing translation in display_value_zh. "
            "Use this shape: {"
            '"observed_fields":{"color":{"value":"...","display_value_zh":"...",'
            '"confidence":0.0,"evidence":"..."}},'
            '"generated_fields":{"title":{"value":"...","display_value_zh":"..."},'
            '"keywords":{"value":["..."],"display_value_zh":["..."]},'
            '"selling_points":{"value":["..."],"display_value_zh":["..."]},'
            '"description":{"value":"...","display_value_zh":"..."}},'
            '"category_suggestions":[{"value":"...","display_value_zh":"...",'
            '"confidence":0.0,"evidence":"..."}],'
            '"warnings":["..."]}. Return no more than three keywords. '
            f"Known facts: {facts}. Category hint: {category_hint or 'none'}."
        )
        if field_guidance:
            prompt = f"{prompt}\n{field_guidance}"
        message_content: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
        message_content.extend(
            {
                "type": "image_url",
                "image_url": {
                    "url": (
                        f"data:{content_type};base64,"
                        f"{base64.b64encode(image_bytes).decode()}"
                    )
                },
            }
            for image_bytes, content_type in images
        )
        payload = {
            "model": self.settings.text_model,
            "messages": [
                {
                    "role": "user",
                    "content": message_content,
                }
            ],
            "temperature": 0.2,
        }
        response = await self.client.post("/chat/completions", json=payload)
        if response.is_error:
            raise AIProviderError(self._provider_error(response))
        try:
            response_content = response.json()["choices"][0]["message"]["content"]
            data = _ProviderAnalysis.model_validate(self._parse_json(response_content))
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
                display_value_zh=item.display_value_zh,
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
                display_value_zh=item.display_value_zh,
                source=FieldSource.AI_GENERATED,
                requires_confirmation=True,
            )
            for name, item in data.generated_fields.items()
            if name not in excluded_fields and item.value not in (None, "")
        }
        suggestions = [
            DraftField(
                value=item.value,
                display_value_zh=item.display_value_zh,
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
        references: list[tuple[bytes, str, str]],
        prompt: str,
        size: str,
        count: int,
    ) -> dict[str, Any]:
        if not references:
            raise AIProviderError("at least one reference image is required")
        reference_note = (
            "The first image is the primary reference; the remaining images show the same "
            "product from other angles or details. Treat them as one product. "
            if len(references) > 1
            else ""
        )
        preservation_prompt = (
            "Preserve the exact product identity, shape, proportions, count, color, labels, "
            "logo, components, and visible construction from the reference image(s). Do not add "
            "or remove product parts, accessories, claims, or certification marks. Do not add "
            "text unless the requested specification image explicitly supplies confirmed "
            "measurement labels; preserve existing product text exactly as shown. "
            f"{reference_note}"
            f"Only change the presentation as requested: {prompt}"
        )
        # A single reference keeps the plain "image" field so behaviour is unchanged;
        # multiple references use the OpenAI-compatible repeated "image[]" field.
        field_name = "image" if len(references) == 1 else "image[]"
        files = [
            (field_name, (file_name, image_bytes, content_type))
            for image_bytes, file_name, content_type in references
        ]
        response = await self.client.post(
            "/images/edits",
            data={
                "model": self.settings.image_model,
                "prompt": preservation_prompt,
                "size": size,
                "n": str(count),
            },
            files=files,
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
