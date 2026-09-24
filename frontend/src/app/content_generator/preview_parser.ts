import type { ContentCard } from "@/types/content_generator";

type PreviewCardType = ContentCard["card_type"];

export type PreviewItem = {
  text: string;
  label: string;
};

export type PreviewParseInput = {
  cardType: PreviewCardType;
  content: string;
  preview: string;
  tips: string[];
  labels: string[];
};

const COPY_FIELD_NAMES = [
  "标题",
  "正文",
  "开场钩子",
  "场景铺垫",
  "痛点切入",
  "成分安心",
  "效果对比",
  "互动引导",
  "信任背书",
  "行动号召",
  "话题",
  "标签",
  "备注",
  "卖点",
  "产品卖点",
  "核心卖点",
  "用户场景",
  "方案说明",
  "体验证明",
];

const SCRIPT_FIELD_NAMES = [
  ...COPY_FIELD_NAMES,
  "画面",
  "口播",
  "字幕",
  "分镜内容",
  "镜头内容",
  "片段内容",
  "产品露出",
];

const NUMBER_MARKER_PATTERN = /^(\d+[\.)、：:]|[-*•]\s*)\s*/;
const VERSION_HEADING_PATTERN = /^(版本|方案)\s*([一二三四五六七八九十\d]+)\s*[：:]?$/;
const STORYBOARD_HEADING_PATTERN =
  /^(?:【\s*(?:分镜|镜头|片段)\s*[一二三四五六七八九十\d]+[^】]*】|(?:分镜|镜头|片段)\s*[一二三四五六七八九十\d]+(?:\s*[：:].*|\s+.*)?)$/;

function normalizeLines(content: string) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(NUMBER_MARKER_PATTERN, "").trim())
    .filter(Boolean);
}

function pushBlock(blocks: string[], lines: string[]) {
  const text = lines.join("\n").trim();
  if (text) blocks.push(text);
}

function splitByHeading(lines: string[], isHeading: (line: string) => boolean) {
  const blocks: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (isHeading(line) && current.length > 0) {
      pushBlock(blocks, current);
      current = [line];
    } else {
      current.push(line);
    }
  }

  pushBlock(blocks, current);
  return blocks;
}

function isVersionHeading(line: string) {
  return VERSION_HEADING_PATTERN.test(line);
}

function isStoryboardHeading(line: string) {
  return STORYBOARD_HEADING_PATTERN.test(line);
}

function isFieldHeading(line: string, cardType: PreviewCardType) {
  const fields = cardType === "script" ? SCRIPT_FIELD_NAMES : COPY_FIELD_NAMES;
  const escapedFields = fields.map((field) => field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const fieldPattern = new RegExp(`^(?:${escapedFields.join("|")})(?:\\s*[：:].*)?$`);
  return fieldPattern.test(line);
}

function splitSentences(content: string) {
  return content
    .split(/(?<=[。！？!?])\s*/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function semanticBlocks(input: PreviewParseInput) {
  const lines = normalizeLines(input.content);
  if (lines.length === 0) {
    return [input.preview, ...input.tips].filter(Boolean);
  }

  if (lines.some(isVersionHeading)) {
    return splitByHeading(lines, isVersionHeading);
  }

  if (input.cardType === "script" && lines.some(isStoryboardHeading)) {
    return splitByHeading(lines, isStoryboardHeading);
  }

  if ((input.cardType === "copy" || input.cardType === "script") && lines.some((line) => isFieldHeading(line, input.cardType))) {
    return splitByHeading(lines, (line) => isFieldHeading(line, input.cardType));
  }

  if (lines.length > 1) {
    return [lines.join("\n")];
  }

  return splitSentences(input.content);
}

export function getContentPreviewItems(input: PreviewParseInput): PreviewItem[] {
  const items = semanticBlocks(input).slice(0, 6);

  return items.map((text, index) => ({
    text,
    label: input.labels[index % input.labels.length],
  }));
}
