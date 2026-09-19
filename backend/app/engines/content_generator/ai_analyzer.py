import json
import re
import threading
from openai import OpenAI
from app.config import CASE_AI_API_KEY, CASE_AI_BASE_URL, CASE_AI_MODEL
from app.config import MODIFY_CARD_AI_API_KEY, MODIFY_CARD_AI_BASE_URL, MODIFY_CARD_AI_MODEL
from app.engines.content_generator.models import ChatMessage, ContentCard

PLATFORM_SKILL_GUARDRAILS = """内置创作技能边界：
1. 你的回答只服务于 Marventa AI 的功能范围：市场洞察、案例库/素材库、内容策划、短视频/图文脚本、标题、正文、话题标签、视觉方案、发布建议和营销复盘。
2. 如果用户询问与本平台无关的通用闲聊、编程、医疗、法律、投资等内容，简短说明当前只能协助营销创作工作，并把问题引导回产品、受众、平台、案例或内容目标。
3. 回答必须精准执行用户当前任务，不主动扩展到无关平台或无关功能；平台已明确时，严格按该平台语境输出。
4. 信息不足时只问 1-2 个关键问题；可以先给一个可执行的最小方案，不要空泛讲理论。
"""

DOCUMENT_WATERMARK = "由 Marventa AI 生成 · 未付费版本保留水印"

SYSTEM_PROMPT = """你是资深新媒体营销内容策划师。你的任务是与用户进行对话，深入了解他们的产品、目标受众、平台偏好和内容需求，然后生成高质量的新媒体营销内容。

关键区分——你必须明确用户需要的内容形式：
- 短视频（抖音、快手、视频号、B站等）：需要分镜脚本、画面描述、口播台词、时长控制，强调前3秒视觉钩子
- 图文（小红书、公众号、微博等）：需要图片文案、正文排版、封面设计思路，强调视觉叙事和文字感染力
- 不同平台有不同调性：抖音重娱乐和节奏感，小红书重真实感和种草，视频号重专业和信任感，B站重内容和社区感
- 如果用户未明确形式或平台，你需要主动询问；如果用户表示「都可以」或不回答，则根据产品特性自行判断最合适的形式

对话时：
- 每次只问1-2个关键问题来收集信息（产品特点、目标受众、期望平台、内容风格等）
- 优先确认用户需要的是视频还是图文，以及目标平台
- 保持对话自然流畅，用中文回复
- 当你收集到足够信息后，告知用户你可以开始生成内容了
- 回复简洁有力，不要啰嗦

回复格式要求：
- 禁止使用任何 Markdown 格式（不要用 **、#、- 、* 等符号），使用纯文本
- 禁止使用表格，用自然段落或简洁的列举代替
- 禁止使用代码块或代码片段
- 用换行和缩进来组织信息层次，让内容清晰易读
- 如需列举，使用中文顿号、分号或「第1」「第2」等自然表达"""

CARD_SYSTEM_PROMPT = """你是一位资深新媒体内容策划师。请根据对话内容，生成以下5种内容卡片的 JSON。

重要：必须根据对话中确定的营销形式（短视频/图文）和平台来调整内容：

如果是短视频（抖音/快手/视频号/B站等）：
1. script（脚本卡）: 完整的分镜脚本，包含开场钩子（前3秒）、口播台词、画面描述、时长标注
2. title（标题卡）: 5-8个吸引眼球的视频标题，适配对应平台的标题风格
3. copy（文案卡）: 视频发布时的配套文案，包含正文+互动引导+置顶评论建议
4. hashtags（话题卡）: 10-15个相关话题标签，按热度/精准度分类
5. visual（视觉卡）: 拍摄风格、色彩搭配、构图建议、场景道具、灯光布置

如果是图文（小红书/公众号/微博等）：
1. script（脚本卡）: 图文发布计划，包含图片顺序与每张图的文案搭配、开头吸引+正文展开+结尾引导的叙事结构
2. title（标题卡）: 5-8个吸引点击的图文标题/封面标题，适配对应平台的标题风格
3. copy（文案卡）: 完整的图文正文，包含开篇钩子、分段展开、互动引导，适配对应平台的文风
4. hashtags（话题卡）: 10-15个相关话题标签，按热度/精准度分类
5. visual（视觉卡）: 图片拍摄/设计风格、滤镜方案、排版布局建议、封面图设计思路

如果对话中未明确形式或平台，根据产品特性和对话上下文自行判断最合适的形式。

返回格式（仅输出 JSON，不要前言或解释）：
{
  "cards": [
    {
      "id": "card_1",
      "card_type": "script",
      "title": "视频分镜脚本",
      "preview": "15秒短视频，开场3秒悬念钩子...",
      "content": "完整的脚本内容，包含分镜、台词、时长...",
      "tips": ["开场3秒内必须出现产品", "结尾添加关注引导"]
    },
    {
      "id": "card_2",
      "card_type": "title",
      "title": "标题文案",
      "preview": "5个高点击率标题方案...",
      "content": "1. 「xxx」- 适合抖音信息流\\n2. 「xxx」- 适合小红书封面\\n...",
      "tips": ["使用数字+情绪词提升CTR", "A/B测试不同标题"]
    },
    {
      "id": "card_3",
      "card_type": "copy",
      "title": "发布文案",
      "preview": "适配平台的完整发布文案...",
      "content": "正文内容...\\n\\n互动引导...",
      "tips": ["文案前3行决定展开率", "结尾用提问引发评论"]
    },
    {
      "id": "card_4",
      "card_type": "hashtags",
      "title": "话题标签",
      "preview": "精选高热度+精准标签组合...",
      "content": "🔥 热门标签: #xxx #xxx\\n🎯 精准标签: #xxx #xxx\\n📈 趋势标签: #xxx #xxx",
      "tips": ["标签数量控制在5-8个为佳", "混合大中小标签获取不同曝光"]
    },
    {
      "id": "card_5",
      "card_type": "visual",
      "title": "视觉方案",
      "preview": "拍摄风格与视觉呈现建议...",
      "content": "拍摄风格: ...\\n色彩方案: ...\\n构图建议: ...\\n场景道具: ...",
      "tips": ["保持视觉风格统一", "前3秒画面要有视觉冲击力"]
    }
  ]
}"""


def strip_markdown(text: str) -> str:
    """Remove markdown formatting symbols while preserving the text content."""
    # Remove bold: **text** or __text__
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)
    text = re.sub(r"__(.+?)__", r"\1", text)
    # Remove italic: *text* or _text_ (but not bullet * at line start)
    text = re.sub(r"(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)", r"\1", text)
    text = re.sub(r"(?<!_)_(?!_)(.+?)(?<!_)_(?!_)", r"\1", text)
    # Remove strikethrough: ~~text~~
    text = re.sub(r"~~(.+?)~~", r"\1", text)
    # Remove inline code: `text`
    text = re.sub(r"`([^`]+)`", r"\1", text)
    # Remove links: [text](url) → text
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    # Remove images: ![alt](url) → alt
    text = re.sub(r"!\[([^\]]*)\]\([^)]+\)", r"\1", text)
    # Remove heading markers: # at line start
    text = re.sub(r"^#{1,6}\s+", "", text, flags=re.MULTILINE)
    # Remove blockquote: > at line start
    text = re.sub(r"^>\s?", "", text, flags=re.MULTILINE)
    # Remove unordered list markers: - * + at line start
    text = re.sub(r"^[\-\*\+]\s+", "", text, flags=re.MULTILINE)
    # Remove ordered list markers: 1. 2. etc at line start
    text = re.sub(r"^\d+\.\s+", "", text, flags=re.MULTILINE)
    # Remove horizontal rules
    text = re.sub(r"^[\-\*\_]{3,}\s*$", "", text, flags=re.MULTILINE)
    return text.strip()


def _get_client() -> OpenAI:
    return OpenAI(api_key=CASE_AI_API_KEY, base_url=CASE_AI_BASE_URL)


def _get_modify_client() -> OpenAI:
    key = MODIFY_CARD_AI_API_KEY or CASE_AI_API_KEY
    url = MODIFY_CARD_AI_BASE_URL or CASE_AI_BASE_URL
    return OpenAI(api_key=key, base_url=url)


def build_reference_context(
    insight_ids: list[str],
    case_ids: list[str],
    user_id: str | None = None,
) -> str:
    """Fetch referenced insights and cases, format as context block for the AI."""
    if not insight_ids and not case_ids:
        return ""

    parts: list[str] = []

    if insight_ids:
        from app.engines.market_insight.storage import get_insight
        parts.append("【参考资料 - 市场洞察】")
        for iid in insight_ids:
            insight = get_insight(iid, user_id) if user_id else get_insight(iid)
            if insight is None:
                continue
            a = insight.ai_analysis
            if a is None:
                parts.append(f"- 产品: {insight.product_name}（暂无 AI 分析）")
                continue
            parts.append(
                f"- 产品: {a.product_name or insight.product_name}\n"
                f"  定位: {a.market_positioning or '无'}\n"
                f"  优势: {a.strengths or '无'}\n"
                f"  目标受众: {a.target_audience or '无'}\n"
                f"  营销角度: {a.suggested_marketing_angles or '无'}"
            )
        parts.append("")

    if case_ids:
        from app.engines.case_library.storage import get_case
        parts.append("【参考资料 - 案例模板】")
        for cid in case_ids:
            case = get_case(cid, user_id) if user_id else get_case(cid)
            if case is None:
                continue
            ct = "短视频" if case.content_type == "video" else "图文"
            parts.append(
                f"- 标题: {case.title}（{ct}）\n"
                f"  描述: {case.description or '无'}\n"
                f"  标签: {', '.join(case.tags) if case.tags else '无'}"
            )
            if case.ai_analysis:
                a = case.ai_analysis
                parts.append(
                    f"  内容分析: {a.content_analysis or '无'}\n"
                    f"  营销角度: {a.marketing_angle or '无'}\n"
                    f"  经验借鉴: {a.experience_extraction or '无'}\n"
                    f"  亮点: {', '.join(a.key_highlights) if a.key_highlights else '无'}"
                )
        parts.append("")

    return "\n".join(parts).strip()


def chat(messages: list[dict], reference_context: str = "") -> str:
    """Send chat messages to AI and get a conversational response."""
    system = PLATFORM_SKILL_GUARDRAILS + "\n\n" + SYSTEM_PROMPT
    if reference_context:
        system = reference_context + "\n\n" + system

    client = _get_client()
    response = client.chat.completions.create(
        model=CASE_AI_MODEL,
        messages=[
            {"role": "system", "content": system},
            *messages,
        ],
        max_tokens=1024,
        temperature=0.7,
    )
    raw = response.choices[0].message.content or "抱歉，我遇到了一些问题，请重试。"
    return strip_markdown(raw)


FIXED_TITLES = {
    "script": "视频分镜/图文脚本",
    "title": "标题文案",
    "copy": "发布文案",
    "hashtags": "话题标签",
    "visual": "视觉方案",
}


def generate_cards(messages: list[dict], reference_context: str = "") -> list[ContentCard]:
    """Generate 5 content cards from the conversation context."""
    convo_text = "\n".join(
        f"{'用户' if m['role'] == 'user' else '策划师'}: {m['content']}"
        for m in messages
    )
    prompt = f"请根据以下对话内容生成5种内容卡片：\n\n{convo_text}\n\n返回格式请严格按照 JSON 要求。"

    system = PLATFORM_SKILL_GUARDRAILS + "\n\n" + CARD_SYSTEM_PROMPT
    if reference_context:
        system = reference_context + "\n\n" + system

    client = _get_client()
    response = client.chat.completions.create(
        model=CASE_AI_MODEL,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
        max_tokens=4096,
        temperature=0.7,
    )

    raw = response.choices[0].message.content or ""

    result = _parse_json_response(raw)
    cards_data = result.get("cards", [])
    cards = []
    for c in cards_data:
        try:
            ct = c.get("card_type", "")
            c["title"] = FIXED_TITLES.get(ct, strip_markdown(c.get("title", "")))
            c["preview"] = strip_markdown(c.get("preview", ""))
            c["content"] = strip_markdown(c.get("content", ""))
            c["tips"] = [strip_markdown(t) for t in c.get("tips", [])]
            cards.append(ContentCard(**c))
        except Exception:
            pass
    return cards


MODIFY_SYSTEM_PROMPT = """你是一位资深新媒体内容策划师。根据用户的修改要求，修改给定的内容卡片，返回修改后的完整卡片 JSON。

修改原则：
- 只修改用户要求改的部分，其他内容保持不变
- 保持与原文一致的风格和语调
- 用纯文本，不要用任何 Markdown 格式
- 如果卡片内容（content）发生了变化，必须同步更新 tips（要点）以准确反映修改后的内容要点，不能保留过时的要点

返回格式（仅输出 JSON）：
{
  "title": "卡片标题",
  "preview": "预览摘要",
  "content": "完整内容",
  "tips": ["要点1", "要点2"]
}"""


def modify_card(card: ContentCard, instruction: str, messages: list[dict]) -> ContentCard:
    """Modify a single content card based on user instruction."""
    convo_text = "\n".join(
        f"{'用户' if m['role'] == 'user' else '策划师'}: {m['content']}"
        for m in messages
    )
    card_json = card.model_dump_json(indent=2)

    prompt = (
        f"对话背景：\n{convo_text}\n\n"
        f"当前卡片（{card.card_type}）：\n{card_json}\n\n"
        f"修改要求：{instruction}\n\n"
        f"请根据修改要求调整卡片内容，返回完整的卡片 JSON。"
    )

    client = _get_modify_client()
    response = client.chat.completions.create(
        model=MODIFY_CARD_AI_MODEL or CASE_AI_MODEL,
        messages=[
            {"role": "system", "content": PLATFORM_SKILL_GUARDRAILS + "\n\n" + MODIFY_SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        max_tokens=2048,
        temperature=0.7,
    )

    raw = response.choices[0].message.content or ""
    result = _parse_json_response(raw)

    ct = card.card_type
    return ContentCard(
        id=card.id,
        card_type=ct,
        title=FIXED_TITLES.get(ct, strip_markdown(result.get("title", card.title))),
        preview=strip_markdown(result.get("preview", card.preview)),
        content=strip_markdown(result.get("content", card.content)),
        tips=[strip_markdown(t) for t in result.get("tips", card.tips)],
    )


DOCUMENT_SYSTEM_PROMPT = """你是一位资深营销策划师和商业报告撰写顾问。根据已有的内容卡片（脚本、标题、文案、话题标签、视觉方案），生成一份正式的综合营销策划报告。

文档要求：
- 必须把智能创作内容重组为报告，而不是直接搬运、拼接或罗列原始卡片文字
- 结构必须具有正式报告特征，建议包含：执行摘要、项目背景与目标、目标受众洞察、核心传播策略、内容创意方案、平台发布节奏、风险与优化建议、下一步行动
- 每个章节都要有明确的小标题和成段论述，标题独立成行
- 开头第一行必须是正式报告标题，不要写“综合文档”这种泛标题
- 补充适当的策略解释、过渡和总结，让文本像可交付给客户/团队的方案报告
- 避免口语化聊天痕迹，不要出现“根据上面的卡片”“你刚才提到”等对话式表达
- 使用纯文本格式输出，人易读
- 禁止使用 Markdown 符号（不要用 #、**、- 、* 等），用自然段落标题和换行缩进表达层次
- 文档主标题放在第一行，与正文之间空一行"""


def generate_document(cards: list[ContentCard], messages: list[dict]) -> str:
    """Generate a comprehensive marketing document from all content cards."""
    convo_text = "\n".join(
        f"{'用户' if m['role'] == 'user' else '策划师'}: {m['content']}"
        for m in messages[-6:]  # last 6 messages for context
    )
    cards_text = "\n\n".join(
        f"【{FIXED_TITLES.get(c.card_type, c.card_type)}】\n{c.content}"
        for c in cards
    )

    prompt = (
        f"对话背景：\n{convo_text}\n\n"
        f"内容卡片：\n{cards_text}\n\n"
        f"请把以上内容卡片重新组织为一份正式的综合营销策划报告。"
        f"不要逐条复制卡片原文，要提炼、归纳、扩写成具有报告感的章节内容。"
    )

    client = _get_client()
    response = client.chat.completions.create(
        model=CASE_AI_MODEL,
        messages=[
            {"role": "system", "content": PLATFORM_SKILL_GUARDRAILS + "\n\n" + DOCUMENT_SYSTEM_PROMPT + "\n\n文档末尾必须保留水印：" + DOCUMENT_WATERMARK},
            {"role": "user", "content": prompt},
        ],
        max_tokens=4096,
        temperature=0.7,
    )

    content = response.choices[0].message.content or ""
    if DOCUMENT_WATERMARK not in content:
        content = content.rstrip() + "\n\n" + DOCUMENT_WATERMARK
    return content


def generate_async(session_id: str) -> None:
    """Run card generation in a background thread."""

    def _run():
        from app.engines.content_generator.storage import get_session, update_session, save_next_version
        try:
            session = get_session(session_id)
            if not session:
                return
            update_session(session_id, status="generating")
            ctx = build_reference_context(
                session.insight_ids, session.case_ids, session.user_id,
            )
            msg_dicts = [m.model_dump() for m in session.messages]
            cards = generate_cards(msg_dicts, reference_context=ctx)
            update_session(session_id, cards=cards, status="completed")
            save_next_version(session_id, cards, is_major_bump=True)
        except Exception:
            update_session(session_id, status="failed")

    t = threading.Thread(target=_run, daemon=True)
    t.start()


def _parse_json_response(text: str) -> dict:
    text = text.strip()
    if text.startswith("```json"):
        text = text[7:]
    if text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    text = text.strip()

    # Fix truncated JSON
    if not text.endswith("}"):
        brace_count = text.count("{") - text.count("}")
        quote_count = text.count('"') % 2
        if quote_count:
            text += '"'
        text += "}" * max(brace_count, 0)
        bracket_count = text.count("[") - text.count("]")
        text += "]" * max(bracket_count, 0)
        text += "}" * max(text.count("{") - text.count("}"), 0)

    result = None
    for attempt in range(3):
        try:
            result = json.loads(text)
            break
        except json.JSONDecodeError:
            if attempt == 0:
                text = re.sub(r",(\s*[}\]])", r"\1", text)
            elif attempt == 1:
                match = re.search(r"\{.*\}", text, re.DOTALL)
                if match:
                    text = re.sub(r",(\s*[}\]])", r"\1", match.group(0))
                else:
                    raise ValueError(f"Failed to parse AI response: {text[:200]}")

    if result is None:
        raise ValueError(f"Failed to parse AI response: {text[:200]}")
    return result
