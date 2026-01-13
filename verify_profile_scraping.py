import os
import sys
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

        print(f"[*] Navigating to {LOGIN_URL} ...")
        page.goto(LOGIN_URL)
        page.wait_for_load_state("networkidle")

        # ログイン処理
        print("[*] Logging in...")
        try:
            # 入力フィールドを探す（luna_bot.pyのロジックを簡略化）
            email_input = None
            for selector in ["input[type='email']", "input[name='email']", "input[placeholder*='メール']"]:
                if page.is_visible(selector):
                    email_input = page.locator(selector).first
                    break
            
            if not email_input:
                raise Exception("Email input not found")

            email_input.fill(EMAIL)
            page.locator("input[type='password']").fill(PASSWORD)
            
            submit_btn = page.get_by_role("button", name="ログイン")
            if not submit_btn.is_visible():
                submit_btn = page.locator("button[type='submit']")
            
            submit_btn.click()
            page.wait_for_timeout(5000) # ログイン待機

        except Exception as e:
            print(f"[!] Login failed: {e}")
            page.screenshot(path="debug_login_fail.png")
            browser.close()
            return

        # プロフィールページへ移動
        print(f"[*] Navigating to {MY_PROFILE_URL} ...")
        page.goto(MY_PROFILE_URL)
        page.wait_for_load_state("networkidle")

        # URLチェック
        print(f"[*] Current URL: {page.url}")
        if "auth" in page.url or "login" in page.url:
            print("[!] Redirected to login page. Session might be invalid.")
            page.screenshot(path="debug_redirect_login.png")
        else:
            # 拡張機能と同じJavaScriptロジックを実行して結果を確認
            print("[*] Executing extension logic (innerText extraction)...")
            
            # options.tsx / content.tsx で使用しているロジック
            # const rawText = doc.body.innerText || doc.body.textContent || ""
            # const cleanText = rawText.split("\n").map(l => l.trim()).filter(l => l.length > 0).join("\n")
            
            js_code = """
            () => {
                const rawText = document.body.innerText || document.body.textContent || "";
                const cleanText = rawText
                    .split("\\n")
                    .map((line) => line.trim())
                    .filter((line) => line.length > 0)
                    .join("\\n");
                return cleanText;
            }
            """
            
            extracted_text = page.evaluate(js_code)
            
            print("-" * 40)
            print(f"[*] Extracted Text Length: {len(extracted_text)}")
            print("[*] Preview (First 200 chars):")
            print(extracted_text[:200])
            print("-" * 40)

            if len(extracted_text) < 50:
                 print("[!] Text seems too short. Verify scraping.")
                 page.screenshot(path="debug_short_text.png")
            else:
                 print("[SUCCESS] Profile text successfully extracted!")

        browser.close()

if __name__ == "__main__":
    main()
