import json

import httpx
import pytest

from backend.app.clients.ai import AIClient, AIProviderError
from backend.app.config import Settings
from backend.app.models import ProductContentTranslationRequest


def ai_settings() -> Settings:
    return Settings(
        openai_api_key="test-key",
        openai_base_url="https://example.test/v1",
        text_model="vision-model",
        image_model="image-model",
    )


@pytest.mark.asyncio
async def test_image_analysis_marks_ai_content_for_confirmation() -> None:
    provider_data = {
        "observed_fields": {
            "color": {"value": "black", "confidence": 0.95, "evidence": "Visible surface"}
        },
        "generated_fields": {
            "title": {"value": "Black Portable Product"},
            "keywords": {"value": ["black product"]},
        },
        "category_suggestions": [
            {"value": "Portable Products", "confidence": 0.7, "evidence": "Visible form"}
        ],
        "warnings": ["Material is not visually verifiable"],
    }

    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/chat/completions"
        payload = json.loads(await request.aread())
        image_url = payload["messages"][0]["content"][1]["image_url"]["url"]
        assert image_url.startswith("data:image/jpeg;base64,")
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": json.dumps(provider_data)}}]},
        )

    client = AIClient(ai_settings(), httpx.MockTransport(handler))
    try:
        result = await client.analyze_product_image(b"image", "image/jpeg", {}, None)
    finally:
        await client.close()

    assert result.observed_fields["color"].requires_confirmation is True
    assert result.generated_fields["title"].requires_confirmation is True
    assert result.category_suggestions[0].requires_confirmation is True
    assert {item.name for item in result.manual_requirements} >= {"price", "material", "moq"}


@pytest.mark.asyncio
async def test_image_analysis_sends_one_consolidated_multi_image_request() -> None:
    provider_data = {
        "observed_fields": {},
        "generated_fields": {"title": {"value": "Watercolor Paper Pad"}},
        "category_suggestions": [],
        "warnings": [],
    }

    async def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(await request.aread())
        content = payload["messages"][0]["content"]
        assert "image set as one product" in content[0]["text"]
        assert len([item for item in content if item["type"] == "image_url"]) == 3
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": json.dumps(provider_data)}}]},
        )

    client = AIClient(ai_settings(), httpx.MockTransport(handler))
    try:
        result = await client.analyze_product_images(
            [
                (b"main", "image/jpeg"),
                (b"specification", "image/png"),
                (b"detail", "image/png"),
            ],
            {},
            None,
        )
    finally:
        await client.close()

    assert result.generated_fields["title"].value == "Watercolor Paper Pad"


@pytest.mark.asyncio
async def test_image_analysis_retries_one_provider_timeout() -> None:
    calls = 0
    provider_data = {
        "observed_fields": {},
        "generated_fields": {"title": {"value": "Recovered Product"}},
        "category_suggestions": [],
        "warnings": [],
    }

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise httpx.ReadTimeout("provider timeout", request=request)
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": json.dumps(provider_data)}}]},
        )

    client = AIClient(ai_settings(), httpx.MockTransport(handler))
    try:
        result = await client.analyze_product_image(b"image", "image/jpeg", {}, None)
    finally:
        await client.close()

    assert calls == 2
    assert result.generated_fields["title"].value == "Recovered Product"


@pytest.mark.asyncio
async def test_image_analysis_localizes_timeout_after_retry() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("provider timeout", request=request)

    client = AIClient(ai_settings(), httpx.MockTransport(handler))
    try:
        with pytest.raises(AIProviderError, match="timed out; please retry"):
            await client.analyze_product_image(b"image", "image/jpeg", {}, None)
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_image_generation_uses_configured_model() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(await request.aread())
        assert payload["model"] == "image-model"
        return httpx.Response(200, json={"data": [{"url": "https://example.test/image.png"}]})

    client = AIClient(ai_settings(), httpx.MockTransport(handler))
    try:
        result = await client.generate_image("studio product photo", "1024x1024", 1)
    finally:
        await client.close()
    assert result["data"][0]["url"].endswith("image.png")


@pytest.mark.asyncio
async def test_product_translation_preserves_field_shape() -> None:
    provider_data = {
        "title": "Professionelles Pinselset, 12-teilig",
        "keywords": ["Pinselset", "Künstlerpinsel"],
        "selling_points": ["12-teilig", "Nylonborsten"],
        "description": "Pinselset Modell PB-12 mit Nylonborsten.",
    }

    async def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(await request.aread())
        prompt = payload["messages"][0]["content"]
        assert "Do not add, remove" in prompt
        assert "PB-12" in prompt
        assert payload["temperature"] == 0
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": json.dumps(provider_data)}}]},
        )

    client = AIClient(ai_settings(), httpx.MockTransport(handler))
    try:
        result = await client.translate_product_content(
            ProductContentTranslationRequest(
                target_language_code="de-DE",
                target_language="German",
                title="Professional 12-Piece Paint Brush Set",
                keywords=["paint brush set", "artist brushes"],
                selling_points=["12-piece set", "nylon bristles"],
                description="Paint brush set model PB-12 with nylon bristles.",
            )
        )
    finally:
        await client.close()
    assert result.target_language_code == "de-DE"
    assert result.title == provider_data["title"]
    assert len(result.keywords) == 2
    assert len(result.selling_points) == 2


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("keywords", "selling_points", "message"),
    [
        (["Pinselset"], ["12-teilig", "Nylonborsten"], "keyword count"),
        (["Pinselset", "Künstlerpinsel"], ["12-teilig"], "selling-point count"),
    ],
)
async def test_product_translation_rejects_changed_array_lengths(
    keywords: list[str],
    selling_points: list[str],
    message: str,
) -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {
                                    "title": "Pinselset",
                                    "keywords": keywords,
                                    "selling_points": selling_points,
                                    "description": "Beschreibung",
                                }
                            )
                        }
                    }
                ]
            },
        )

    client = AIClient(ai_settings(), httpx.MockTransport(handler))
    try:
        with pytest.raises(AIProviderError, match=message):
            await client.translate_product_content(
                ProductContentTranslationRequest(
                    target_language_code="de-DE",
                    target_language="German",
                    title="Paint Brush Set",
                    keywords=["paint brush set", "artist brushes"],
                    selling_points=["12-piece set", "nylon bristles"],
                    description="Description",
                )
            )
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_product_translation_rejects_invalid_provider_json() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"choices": [{"message": {"content": "not-json"}}]})

    client = AIClient(ai_settings(), httpx.MockTransport(handler))
    try:
        with pytest.raises(AIProviderError, match="invalid translation response"):
            await client.translate_product_content(
                ProductContentTranslationRequest(
                    target_language_code="de-DE",
                    target_language="German",
                    title="Paint Brush Set",
                )
            )
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_image_analysis_removes_ai_sourced_business_facts() -> None:
    provider_data = {
        "observed_fields": {
            "color": {"value": "black", "confidence": 0.9},
            "material": {"value": "plastic", "confidence": 0.4},
        },
        "generated_fields": {
            "price": {"value": "9.99"},
            "keywords": {"value": ["one", "two", "three", "four"]},
        },
        "category_suggestions": [],
        "warnings": [],
    }

    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": json.dumps(provider_data)}}]},
        )

    client = AIClient(ai_settings(), httpx.MockTransport(handler))
    try:
        result = await client.analyze_product_image(b"image", "image/jpeg", {}, None)
    finally:
        await client.close()
    assert "color" in result.observed_fields
    assert "material" not in result.observed_fields
    assert "price" not in result.generated_fields
    assert result.generated_fields["keywords"].value == ["one", "two", "three"]
    assert any("material" in warning and "price" in warning for warning in result.warnings)


@pytest.mark.asyncio
async def test_product_image_edit_uses_reference_and_requires_confirmation() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        body = (await request.aread()).decode(errors="ignore")
        assert request.url.path == "/v1/images/edits"
        assert 'name="image"; filename="brush.jpg"' in body
        assert "Preserve the exact product identity" in body
        return httpx.Response(200, json={"data": [{"url": "https://example.test/edit.png"}]})

    client = AIClient(ai_settings(), httpx.MockTransport(handler))
    try:
        result = await client.edit_product_image(
            [(b"image", "brush.jpg", "image/jpeg")],
            "use a white studio background",
            "1024x1024",
            1,
        )
    finally:
        await client.close()
    assert result["requires_confirmation"] is True
    assert result["source_image_preservation_required"] is True


@pytest.mark.asyncio
async def test_product_image_edit_sends_multiple_references() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        body = (await request.aread()).decode(errors="ignore")
        assert request.url.path == "/v1/images/edits"
        # Multiple references use the repeated image[] field.
        assert 'name="image[]"; filename="front.jpg"' in body
        assert 'name="image[]"; filename="side.jpg"' in body
        assert "The first image is the primary reference" in body
        return httpx.Response(200, json={"data": [{"url": "https://example.test/edit.png"}]})

    client = AIClient(ai_settings(), httpx.MockTransport(handler))
    try:
        result = await client.edit_product_image(
            [
                (b"front", "front.jpg", "image/jpeg"),
                (b"side", "side.jpg", "image/jpeg"),
            ],
            "use a white studio background",
            "1024x1024",
            1,
        )
    finally:
        await client.close()
    assert result["requires_confirmation"] is True
