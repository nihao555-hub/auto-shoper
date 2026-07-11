import json

import httpx
import pytest

from backend.app.clients.ai import AIClient
from backend.app.config import Settings


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
            b"image",
            "brush.jpg",
            "image/jpeg",
            "use a white studio background",
            "1024x1024",
            1,
        )
    finally:
        await client.close()
    assert result["requires_confirmation"] is True
    assert result["source_image_preservation_required"] is True
