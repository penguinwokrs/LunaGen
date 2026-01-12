import os
import sys
import abc
from google import genai
from google.genai import types
from openai import OpenAI

class AIMessageGenerator(abc.ABC):
    @abc.abstractmethod
    def generate(self, my_profile, target_profile, prompt_template):
        """
        プロンプトテンプレートとプロフィール情報を受け取り、メッセージを生成する。
        """
        pass

class GeminiMessageGenerator(AIMessageGenerator):
    def __init__(self, api_key, model_name="gemini-3-flash-preview"):
        self.api_key = api_key
        self.model_name = model_name
        self.client = genai.Client(api_key=self.api_key)

    def generate(self, my_profile, target_profile, prompt_template):
        prompt = prompt_template.format(
            my_info_clean=my_profile,
            target_info_clean=target_profile
        )
        
        try:
            response = self.client.models.generate_content(
                model=self.model_name,
                contents=prompt,
                config=types.GenerateContentConfig(
                    safety_settings=[
                        types.SafetySetting(
                            category="HARM_CATEGORY_SEXUALLY_EXPLICIT",
                            threshold="BLOCK_NONE"
                        ),
                        types.SafetySetting(
                            category="HARM_CATEGORY_HATE_SPEECH",
                            threshold="BLOCK_NONE"
                        ),
                        types.SafetySetting(
                            category="HARM_CATEGORY_HARASSMENT",
                            threshold="BLOCK_NONE"
                        ),
                        types.SafetySetting(
                            category="HARM_CATEGORY_DANGEROUS_CONTENT",
                            threshold="BLOCK_NONE"
                        ),
                    ]
                )
            )
            return response.text.strip()
        except Exception as e:
            print(f"[!] Gemini API Error: {e}")
            return None

class OpenAIMessageGenerator(AIMessageGenerator):
    def __init__(self, api_key, model_name="gpt-4o"):
        self.api_key = api_key
        self.model_name = model_name
        self.client = OpenAI(api_key=self.api_key)

    def generate(self, my_profile, target_profile, prompt_template):
        prompt = prompt_template.format(
            my_info_clean=my_profile,
            target_info_clean=target_profile
        )

        try:
            response = self.client.chat.completions.create(
                model=self.model_name,
                messages=[
                    {"role": "system", "content": "You are a helpful assistant."},
                    {"role": "user", "content": prompt}
                ],
                max_tokens=300
            )
            return response.choices[0].message.content.strip()
        except Exception as e:
            print(f"[!] OpenAI API Error: {e}")
            return None

def get_message_generator():
    provider = os.getenv("AI_PROVIDER", "gemini").lower()
    
    if provider == "openai":
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            print("[!] Error: OPENAI_API_KEY not found.")
            sys.exit(1)
        print("[*] Using OpenAI Provider")
        return OpenAIMessageGenerator(api_key)
    else:
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            print("[!] Error: GEMINI_API_KEY not found.")
            sys.exit(1)
        print("[*] Using Gemini Provider")
        return GeminiMessageGenerator(api_key)
