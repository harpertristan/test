"""Small, deterministic classification of the current Hermes message.

No browser queries, external content or task data are interpreted as instructions.
The classifier only selects a trusted tool-use guide; it never authorizes actions.
"""
import re

_PRODUCT = re.compile(
    r"(?i)(?:play[\s-]*scout|плей[\s-]*скаут|пл[еэ]й[\s-]*скаут)"
)
_IMPROVE = re.compile(
    r"(?i)(?:улучш|модерниз|оптимиз|архитектур|функционал|"
    r"доработ|разработ|исходн|код|репозитор|производительн|"
    r"исправ|предлож|предлага|enhanc|improv|refactor|feature|codebase)"
)
_RESEARCH = re.compile(
    r"(?i)(?:проверь компанию|найди банк|провер[ьк].*лиценз|"
    r"сайт компании|регулятор|iban|free2move|research company)"
)

_PRODUCT_GUIDE = (
    "\n[Текущий запрос: ТЕХНИЧЕСКИЙ АНАЛИЗ PLAY SCOUT.] "
    "Отвечай на задачу о самом программном продукте Play Scout. "
    "Не исследуй отдельные компании и не запускай web_research ради анализа внутреннего кода. "
    "Сначала вызови operator_capabilities (если нужен список возможностей), "
    "затем developer_workspace(action=list); прочитай релевантные файлы через "
    "developer_workspace(action=read,path=...). "
    "Дополнительно используй scout_read для фактических метрик, если они нужны. "
    "Дай конкретные предложения с путями файлов, наблюдениями и приоритетами. "
    "Если исходники Play Scout отсутствуют в рабочей копии, сообщи об ограничении, "
    "но используй доступный код интеграции и фактические возможности Scout: "
    "чётко разделяй подтверждённые дефекты и гипотезы. "
    "Не выдавай общие советы по UI, API или мобильной версии без доказательств. "
    "Сбой Web Research не должен блокировать технические предложения. "
    "Ничего не публикуй и не меняй в production без отдельного одобрения.\n"
)
_RESEARCH_GUIDE = (
    "\n[Текущий запрос: ВНЕШНЕЕ ИССЛЕДОВАНИЕ.] "
    "Используй факты Scout и подтверждённые публичные URL; "
    "для web_research(open) используй зарегистрированный официальный HTTPS-сайт. "
    "При ошибке покажи реальный код инструмента; не утверждай, что компания "
    "не предоставляет услугу, только из-за недоступности сайта.\n"
)
_GENERAL_GUIDE = (
    "\n[Текущий запрос: ОБЫЧНАЯ БЕСЕДА ИЛИ ВОПРОС.] "
    "Отвечай прямо на последнее сообщение пользователя. "
    "Не запускай публичный поиск без необходимости, не воспроизводи отчёты "
    "о ранее исследованных компаниях.\n"
)

def classify_user_intent(message: str) -> str:
    if not isinstance(message, str):
        return "general"
    text = message[:8000]
    if _PRODUCT.search(text) and _IMPROVE.search(text):
        return "product"
    if _RESEARCH.search(text):
        return "research"
    return "general"

def intent_guide(message: str) -> str:
    kind = classify_user_intent(message)
    return {
        "product": _PRODUCT_GUIDE,
        "research": _RESEARCH_GUIDE,
        "general": _GENERAL_GUIDE,
    }[kind]
