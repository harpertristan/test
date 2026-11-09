import unittest
from hermes_intent_router import classify_user_intent, intent_guide
from hermes_gateway_bridge import build_chat_instructions

class IntentRouterTests(unittest.TestCase):
    def test_product_request_stays_product(self):
        for prompt in [
            "Что можно улучшить в плей скаут?",
            "Предложи 5 улучшений Play Scout на основе исходного кода",
            "Разработай новую архитектуру PLAY-SCOUT",
        ]:
            self.assertEqual(classify_user_intent(prompt), "product", prompt)

    def test_company_research_is_distinct(self):
        self.assertEqual(classify_user_intent("Проверь компанию Free2move"), "research")

    def test_chat_routes_product_without_rerouting_to_company(self):
        prompt=build_chat_instructions("", "TEST_GRANT", "Какие улучшения Play Scout предлагаешь?")
        self.assertIn("ТЕХНИЧЕСКИЙ АНАЛИЗ PLAY SCOUT",prompt)
        self.assertIn("developer_workspace(action=list)",prompt)
        self.assertIn("[[workspace-task-grant:TEST_GRANT]]",prompt)

    def test_fallback_does_not_require_browser(self):
        text=intent_guide("Предложи улучшения Play Scout")
        self.assertIn("Сбой Web Research не должен блокировать",text)

    def test_plain_conversation_does_not_route_old_topic(self):
        self.assertEqual(classify_user_intent("Привет!"),"general")
        self.assertNotIn("ТЕХНИЧЕСКИЙ", intent_guide("Привет!"))

if __name__ == "__main__":
    unittest.main()
