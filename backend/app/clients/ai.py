import asyncio
import base64
import json
from typing import Any

import httpx
from pydantic import BaseModel, Field, ValidationError

from backend.app.config import Settings
from backend.app.models import (
    DraftField,
    FieldSource,
    ProductContentTranslationRequest,
    ProductContentTranslationResponse,
    ProductImageAnalysis,
)
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


class _ProviderTranslation(BaseModel):
    title: str
    keywords: list[str] = Field(default_factory=list)
    selling_points: list[str] = Field(default_factory=list)
    description: str = ""


class _ProviderCategoryRanking(BaseModel):
    category_id: str
    confidence: float = Field(ge=0, le=1)
    reason: str = Field(min_length=1, max_length=300)


class _ProviderCategoryRankings(BaseModel):
    rankings: list[_ProviderCategoryRanking] = Field(default_factory=list, max_length=3)


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
            '"description":{"value":"...","display_value_zh":"..."},'
            '"use_scenario":{"value":"...","display_value_zh":"..."}},'
            '"category_suggestions":[{"value":"...","display_value_zh":"...",'
            '"confidence":0.0,"evidence":"..."}],'
            '"warnings":["..."]}. Return no more than three keywords. '
            "use_scenario must describe one realistic buyer use scenario in a short English "
            "phrase grounded only in the visible product type, without inventing performance "
            "or commercial claims. "
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
        response = await self._post_with_retry("/chat/completions", json=payload)
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

    async def translate_product_content(
        self,
        request: ProductContentTranslationRequest,
    ) -> ProductContentTranslationResponse:
        content = {
            "title": request.title,
            "keywords": request.keywords,
            "selling_points": request.selling_points,
            "description": request.description,
        }
        prompt = (
            f"Translate the supplied Alibaba.com product listing from {request.source_language} "
            f"to {request.target_language} ({request.target_language_code}). Return JSON only "
            'with keys "title", "keywords", "selling_points", and "description". Preserve every '
            "number, unit, model number, trademark, material, certification, HTML tag, and factual "
            "claim exactly. Do not add, remove, summarize, improve, localize, or infer facts. Keep "
            "keyword and selling-point array lengths unchanged. Use natural buyer-facing language "
            "for the target market while preserving the source meaning. "
            f"Source content: {json.dumps(content, ensure_ascii=False)}"
        )
        response = await self._post_with_retry(
            "/chat/completions",
            json={
                "model": self.settings.text_model,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0,
            },
        )
        if response.is_error:
            raise AIProviderError(self._provider_error(response))
        try:
            response_content = response.json()["choices"][0]["message"]["content"]
            translated = _ProviderTranslation.model_validate(self._parse_json(response_content))
        except (
            KeyError,
            IndexError,
            TypeError,
            ValueError,
            ValidationError,
            json.JSONDecodeError,
        ) as exc:
            raise AIProviderError("AI provider returned an invalid translation response") from exc
        if len(translated.keywords) != len(request.keywords):
            raise AIProviderError("AI provider changed the keyword count during translation")
        if len(translated.selling_points) != len(request.selling_points):
            raise AIProviderError("AI provider changed the selling-point count during translation")
        return ProductContentTranslationResponse(
            target_language_code=request.target_language_code,
            target_language=request.target_language,
            title=translated.title,
            keywords=translated.keywords,
            selling_points=translated.selling_points,
            description=translated.description,
        )

    async def rank_category_candidates(
        self,
        *,
        title: str,
        keywords: list[str],
        category_hint: str,
        visible_traits: list[str],
        candidates: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        if not candidates:
            return []
        candidate_ids = {str(candidate["category_id"]) for candidate in candidates}
        prompt = (
            "Select the best Alibaba.com product categories for the supplied product. "
            "You may only choose category_id values from candidates. Never invent, translate, "
            "or alter an ID. Rank semantic product fit, not word similarity alone. Return JSON "
            'only with shape {"rankings":[{"category_id":"...","confidence":0.0,'
            '"reason":"short Simplified Chinese explanation"}]}. Return at most three unique '
            "rankings. The reason must explain why the product belongs in that category. "
            f"Product title: {title}. Keywords: {json.dumps(keywords, ensure_ascii=False)}. "
            f"Existing AI category hint: {category_hint or 'none'}. "
            f"Visible traits: {json.dumps(visible_traits, ensure_ascii=False)}. "
            f"Candidates: {json.dumps(candidates, ensure_ascii=False)}"
        )
        response = await self._post_with_retry(
            "/chat/completions",
            json={
                "model": self.settings.text_model,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0,
            },
        )
        if response.is_error:
            raise AIProviderError(self._provider_error(response))
        try:
            response_content = response.json()["choices"][0]["message"]["content"]
            ranked = _ProviderCategoryRankings.model_validate(self._parse_json(response_content))
        except (
            KeyError,
            IndexError,
            TypeError,
            ValueError,
            ValidationError,
            json.JSONDecodeError,
        ) as exc:
            raise AIProviderError("AI provider returned an invalid category ranking") from exc

        result: list[dict[str, Any]] = []
        seen: set[str] = set()
        for item in ranked.rankings:
            if item.category_id not in candidate_ids or item.category_id in seen:
                continue
            seen.add(item.category_id)
            result.append(item.model_dump())
        return result

    async def generate_image(self, prompt: str, size: str, count: int) -> dict[str, Any]:
        response = await self._post_with_retry(
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
        if self.settings.image_provider.casefold() == "grsai":
            return await self._edit_product_image_grsai(
                references,
                preservation_prompt,
                size,
            )
        active_references = references
        response: httpx.Response | None = None
        attempts = 3
        for attempt in range(attempts):
            # A single reference keeps the plain "image" field; compatible providers may
            # accept repeated image[] fields. Overloaded/incompatible providers fall back
            # to the primary image on retry so product identity remains grounded.
            field_name = "image" if len(active_references) == 1 else "image[]"
            files = [
                (field_name, (file_name, image_bytes, content_type))
                for image_bytes, file_name, content_type in active_references
            ]
            try:
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
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                if attempt + 1 >= attempts:
                    if isinstance(exc, httpx.TimeoutException):
                        raise AIProviderError("Image provider timed out; please retry") from exc
                    raise AIProviderError("Image provider connection failed; please retry") from exc
                active_references = active_references[:1]
                await asyncio.sleep(0.75 * (2**attempt))
                continue
            if not response.is_error:
                break
            provider_error = self._provider_error(response)
            retryable = (
                response.status_code in {429, 500, 502, 503, 504}
                or "excessive system load" in provider_error.casefold()
                or (response.status_code == 400 and len(active_references) > 1)
            )
            if attempt + 1 >= attempts or not retryable:
                raise AIProviderError(provider_error)
            active_references = active_references[:1]
            await asyncio.sleep(0.75 * (2**attempt))
        if response is None:
            raise AIProviderError("Image provider request failed")
        data = response.json()
        if not isinstance(data, dict) or not isinstance(data.get("data"), list):
            raise AIProviderError("Image provider returned an invalid response")
        return {
            **data,
            "requires_confirmation": True,
            "source_image_preservation_required": True,
        }

    async def _edit_product_image_grsai(
        self,
        references: list[tuple[bytes, str, str]],
        prompt: str,
        size: str,
    ) -> dict[str, Any]:
        """Use GrsAI's unified async API instead of its capacity-sensitive legacy edit route."""
        active_references = references
        task: dict[str, Any] | None = None
        attempts = 3
        for attempt in range(attempts):
            images = [
                f"data:{content_type};base64,{base64.b64encode(image_bytes).decode('ascii')}"
                for image_bytes, _file_name, content_type in active_references
            ]
            try:
                response = await self.client.post(
                    "/api/generate",
                    json={
                        "model": self.settings.image_model,
                        "prompt": prompt,
                        "images": images,
                        "aspectRatio": size,
                        "replyType": "async",
                    },
                    timeout=45,
                )
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                if attempt + 1 >= attempts:
                    if isinstance(exc, httpx.TimeoutException):
                        raise AIProviderError("Image provider timed out; please retry") from exc
                    raise AIProviderError("Image provider connection failed; please retry") from exc
                active_references = active_references[:1]
                await asyncio.sleep(1.5 * (2**attempt))
                continue
            if not response.is_error:
                parsed = response.json()
                if not isinstance(parsed, dict):
                    raise AIProviderError("Image provider returned an invalid response")
                task = parsed
                break
            provider_error = self._provider_error(response)
            retryable = response.status_code in {429, 500, 502, 503, 504} or any(
                marker in provider_error.casefold()
                for marker in ("excessive system load", "busy", "overload")
            )
            if attempt + 1 >= attempts or not retryable:
                raise AIProviderError(provider_error)
            active_references = active_references[:1]
            await asyncio.sleep(1.5 * (2**attempt))

        if task is None:
            raise AIProviderError("Image provider request failed")
        task_id = task.get("id")
        for poll_attempt in range(72):
            status = str(task.get("status") or "").casefold()
            if status == "succeeded":
                results = task.get("results")
                if not isinstance(results, list) or not results:
                    raise AIProviderError("Image provider returned no image")
                return {
                    "data": results,
                    "requires_confirmation": True,
                    "source_image_preservation_required": True,
                }
            if status in {"failed", "violation"}:
                raise AIProviderError(str(task.get("error") or f"Image generation {status}"))
            if not isinstance(task_id, str) or not task_id:
                raise AIProviderError("Image provider returned no task id")
            if poll_attempt + 1 >= 72:
                break
            await asyncio.sleep(2.5)
            try:
                poll_response = await self.client.get(
                    "/api/result",
                    params={"id": task_id},
                    timeout=30,
                )
            except (httpx.TimeoutException, httpx.TransportError):
                continue
            if poll_response.status_code in {429, 500, 502, 503, 504}:
                continue
            if poll_response.is_error:
                raise AIProviderError(self._provider_error(poll_response))
            parsed = poll_response.json()
            if not isinstance(parsed, dict):
                raise AIProviderError("Image provider returned an invalid task result")
            task = parsed
        raise AIProviderError("Image generation is still processing; please retry later")

    async def _post_with_retry(self, path: str, **kwargs: Any) -> httpx.Response:
        attempts = 2
        for attempt in range(attempts):
            try:
                return await self.client.post(path, **kwargs)
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                if attempt + 1 < attempts:
                    await asyncio.sleep(0.25)
                    continue
                if isinstance(exc, httpx.TimeoutException):
                    raise AIProviderError("AI provider timed out; please retry") from exc
                raise AIProviderError("AI provider connection failed; please retry") from exc
        raise AIProviderError("AI provider request failed")

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
