import os
import sys
import json
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright

# .env 読み込み
load_dotenv()

LOGIN_URL = "https://luna-matching.com/auth"
MY_PROFILE_URL = "https://luna-matching.com/profile"
EMAIL = os.getenv("LUNA_EMAIL")
PASSWORD = os.getenv("LUNA_PASSWORD")

if not EMAIL or not PASSWORD:
    print("Error: LUNA_EMAIL or LUNA_PASSWORD not found in .env")
    sys.exit(1)

def main():
    with sync_playwright() as p:
        # ブラウザ起動
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
             user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
        page = context.new_page()

        # APIレスポンスを監視するリスト
        captured_responses = []

        # ネットワークリクエストの監視設定
        def handle_response(response):
            # APIっぽいURLかつJSONを返すものを対象に
            if "/api/user/" in response.url and response.status == 200:
                try:
                    # JSONとしてパースを試みる
                    json_data = response.json()
                    captured_responses.append({
                        "url": response.url,
                        "data": json_data
                    })
                    print(f"[API CAPTURED] {response.url}")
                except:
                    pass

        page.on("response", handle_response)

        print(f"[*] Navigating to {LOGIN_URL} ...")
        page.goto(LOGIN_URL)
        page.wait_for_load_state("networkidle")

        # ログイン処理
        print("[*] Logging in...")
        try:
            email_input = None
            for selector in ["input[type='email']", "input[name='email']", "input[placeholder*='メール']"]:
                if page.is_visible(selector):
                    email_input = page.locator(selector).first
                    break
            
            if not email_input:
                # 既にログイン済みなどで入力欄がない場合
                if "auth" not in page.url:
                     print("[?] Already logged in?")
                else:
                     raise Exception("Email input not found")
            else:
                email_input.fill(EMAIL)
                page.locator("input[type='password']").fill(PASSWORD)
                
                submit_btn = page.get_by_role("button", name="ログイン")
                if not submit_btn.is_visible():
                    submit_btn = page.locator("button[type='submit']")
                
                submit_btn.click()
                page.wait_for_timeout(5000)

        except Exception as e:
            print(f"[!] Login process warning: {e}")

        # プロフィールページへ移動
        print(f"[*] Navigating to {MY_PROFILE_URL} ...")
        page.goto(MY_PROFILE_URL)
        
        # APIリクエストが飛ぶのを少し待つ
        page.wait_for_timeout(5000) 
        page.wait_for_load_state("networkidle")

        print("-" * 40)
        print(f"[*] Total API Responses Captured: {len(captured_responses)}")
        
        has_profile_data = False
        for res in captured_responses:
            print(f"\n[URL] {res['url']}")
            # データの中身を少しだけ表示
            data_str = json.dumps(res['data'], ensure_ascii=False)
            print(f"[DATA PREVIEW] {data_str[:200]}...")
            
            # 期待するデータが含まれているかチェック
            if "introduction" in data_str or "name" in data_str: # 一般的なフィールド
                 has_profile_data = True

        print("-" * 40)
        
        if has_profile_data:
            print("[SUCCESS] JSON data containing profile-like information was captured!")
        else:
            print("[WARNING] No obvious profile JSON data found. The site might be using SSR or different API structure.")

        browser.close()

if __name__ == "__main__":
    main()
