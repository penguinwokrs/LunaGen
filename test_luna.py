from playwright.sync_api import sync_playwright

def test_luna_site():
    try:
        with sync_playwright() as p:
            print("Launching browser...")
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            )
            page = context.new_page()
            print("Navigating to https://luna-matching.com/ ...")
            page.goto("https://luna-matching.com/", timeout=60000)
            print(f"Title: {page.title()}")
            print("Navigation successful!")
            browser.close()
            print("Browser closed.")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    test_luna_site()
