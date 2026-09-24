import test from "node:test";
import assert from "node:assert/strict";
import { getContentPreviewItems } from "./preview_parser.ts";

const labels = ["场景铺垫", "痛点切入", "成分安心", "效果对比", "信任背书", "行动号召"];

test("groups storyboard content by shot heading instead of plain lines", () => {
  const items = getContentPreviewItems({
    cardType: "script",
    content: [
      "【分镜1：0-3秒】",
      "开场钩子",
      "画面：特写BJD娃的脸或手部，展示衣服细节",
      "口播：这套新衣服也太显贵了",
      "",
      "【分镜2：4-8秒】",
      "卖点展示",
      "字幕：蕾丝花边、双层裙摆、可拆卸蝴蝶结",
    ].join("\n"),
    preview: "",
    tips: [],
    labels,
  });

  assert.equal(items.length, 2);
  assert.equal(items[0].text, "【分镜1：0-3秒】\n开场钩子\n画面：特写BJD娃的脸或手部，展示衣服细节\n口播：这套新衣服也太显贵了");
  assert.equal(items[1].text, "【分镜2：4-8秒】\n卖点展示\n字幕：蕾丝花边、双层裙摆、可拆卸蝴蝶结");
});

test("keeps copy field heading and body in the same semantic unit", () => {
  const items = getContentPreviewItems({
    cardType: "copy",
    content: [
      "正文：",
      "给八分娃换上这套新衣服，瞬间变高贵小公主 👸 ✨",
      "",
      "痛点切入：",
      "蕾丝花边、双层裙摆、可拆卸蝴蝶结...细节多到数不完！",
      "",
      "互动引导：",
      "你最喜欢哪个细节？评论区告诉我👇",
    ].join("\n"),
    preview: "",
    tips: [],
    labels,
  });

  assert.equal(items.length, 3);
  assert.equal(items[0].text, "正文：\n给八分娃换上这套新衣服，瞬间变高贵小公主 👸 ✨");
  assert.equal(items[1].text, "痛点切入：\n蕾丝花边、双层裙摆、可拆卸蝴蝶结...细节多到数不完！");
  assert.equal(items[2].text, "互动引导：\n你最喜欢哪个细节？评论区告诉我👇");
});

test("groups versions before parsing fields inside each version", () => {
  const items = getContentPreviewItems({
    cardType: "copy",
    content: [
      "版本一",
      "正文：",
      "第一版正文",
      "互动引导：",
      "第一版互动",
      "",
      "版本二",
      "正文：",
      "第二版正文",
      "行动号召：",
      "第二版行动",
    ].join("\n"),
    preview: "",
    tips: [],
    labels,
  });

  assert.equal(items.length, 2);
  assert.equal(items[0].text, "版本一\n正文：\n第一版正文\n互动引导：\n第一版互动");
  assert.equal(items[1].text, "版本二\n正文：\n第二版正文\n行动号召：\n第二版行动");
});
