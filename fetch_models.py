
import os
import http.client
import json
import re

def load_env():
    env = {}
    try:
        with open("/home/owner/projects/github.com/penguinwokrs/matting/.env", "r") as f:
            for line in f:
                if "=" in line and not line.startswith("#"):
                    key, value = line.strip().split("=", 1)
                    env[key] = value.strip('"').strip("'")
    except:
        pass
    return env

def fetch_gemini_models(api_key):
    if not api_key: return []
    try:
        conn = http.client.HTTPSConnection("generativelanguage.googleapis.com")
        conn.request("GET", f"/v1beta/models?key={api_key}")
        res = conn.getresponse()
        data = json.loads(res.read().decode())
        models = [m["name"].replace("models/", "") for m in data.get("models", []) 
                  if "generateContent" in m.get("supportedGenerationMethods", [])]
        return sorted(list(set(models)))
    except Exception as e:
        print(f"Gemini Error: {e}")
        return []

def fetch_openai_models(api_key):
    if not api_key: return []
    try:
        conn = http.client.HTTPSConnection("api.openai.com")
        headers = {"Authorization": f"Bearer {api_key}"}
        conn.request("GET", "/v1/models", headers=headers)
        res = conn.getresponse()
        data = json.loads(res.read().decode())
        models = [m["id"] for m in data.get("data", []) if m["id"].startswith(("gpt-", "o1-"))]
        return sorted(models)
    except Exception as e:
        print(f"OpenAI Error: {e}")
        return []

if __name__ == "__main__":
    env = load_env()
    
    gemini_key = env.get("GEMINI_API_KEY")
    openai_key = env.get("OPENAI_API_KEY")

    print("Fetching Gemini models...")
    gemini = fetch_gemini_models(gemini_key)
    print("\nconst GEMINI_MODELS = [")
    for m in gemini:
        print(f'  "{m}",')
    print("]")

    print("\nFetching OpenAI models...")
    openai = fetch_openai_models(openai_key)
    print("\nconst OPENAI_MODELS = [")
    for m in openai:
        print(f'  "{m}",')
    print("]")
