import test from "node:test";
import assert from "node:assert/strict";
import { get_card_content_format, get_content_preview_items } from "./contentGeneratorCardDetails.ts";
import type { ContentCard } from "../../types/content_generator.ts";

function card(fields: Partial<ContentCard>): ContentCard {
  return { id: "test-card", card_type: "script", title: "", preview: "", content: "", tips: [], ...fields };
}

test("Chinese and English canonical script titles preserve their content format", () => {
  for (const title of ["视频分镜脚本", "Video storyboard", " VIDEO STORYBOARD "]) {
    assert.equal(get_card_content_format(card({ title, content: "Cover image and carousel" })), "short_video");
  }
  for (const title of ["图文发布计划", "Image-text publishing plan"]) {
    assert.equal(get_card_content_format(card({ title, content: "Video storyboard and voiceover" })), "image_text");
  }
});

test("custom English video titles use case-insensitive evidence and video preview labels", () => {
  const video = card({
    title: "Product launch plan",
    preview: "SHORT VIDEO",
    content: "Storyboard: introduce the product.\nVoiceover: explain the key benefit.",
  });
  assert.equal(get_card_content_format(video), "short_video");
  assert.deepEqual(
    get_content_preview_items(video, (_zh, en) => en).map((item) => item.label),
    ["Opening hook", "Storyboard"],
  );
});

test("English image-post content is not mistaken for a video plan", () => {
  assert.equal(get_card_content_format(card({
    title: "Launch campaign",
    content: "CAROUSEL: outline the image sequence, cover image, and post copy.",
  })), "image_text");
});

test("legacy Chinese evidence and ambiguous-content fallback remain supported", () => {
  assert.equal(get_card_content_format(card({ content: "短视频分镜和口播台词" })), "short_video");
  assert.equal(get_card_content_format(card({ content: "图文正文和封面图" })), "image_text");
  assert.equal(get_card_content_format(card({ content: "A general campaign outline" })), "image_text");
});
