from playwright.sync_api import sync_playwright

def test_browser():
    try:
        with sync_playwright() as p:
            print("Launching browser...")
            browser = p.chromium.launch(headless=True)
            print("Browser launched successfully!")
            page = browser.new_page()
            print("Navigating to about:blank...")
            page.goto("about:blank")
            print("Navigation successful!")
            browser.close()
            print("Browser closed.")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    test_browser()
